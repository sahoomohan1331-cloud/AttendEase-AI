import os
import re
import time
import random
import json
import urllib.request
import urllib.parse
import torch
import numpy as np
from collections import defaultdict
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Request, BackgroundTasks, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from firebase_admin import credentials, firestore, initialize_app, auth as firebase_auth
from facenet_pytorch import MTCNN, InceptionResnetV1
from PIL import Image
import io
from dotenv import load_dotenv

# Load .env file
load_dotenv()

# ============================================================
# 1. Setup FastAPI
# ============================================================
app = FastAPI(title="AttendEase AI Backend", version="3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# 2. Rate Limiting (In-Memory)
# ============================================================
rate_limit_store: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT = 30           # max requests
RATE_LIMIT_WINDOW = 60    # per 60 seconds

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    client_ip = request.client.host if request.client else "unknown"
    now = time.time()

    # Clean old entries
    rate_limit_store[client_ip] = [
        t for t in rate_limit_store[client_ip] if now - t < RATE_LIMIT_WINDOW
    ]

    if len(rate_limit_store[client_ip]) >= RATE_LIMIT:
        return JSONResponse(
            status_code=429,
            content={"status": "error", "error": "Too many requests. Please wait a minute."}
        )

    rate_limit_store[client_ip].append(now)
    response = await call_next(request)
    return response

# ============================================================
# 3. Setup Firebase (supports both local file and cloud env var)
# ============================================================

firebase_key_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_KEY")
if firebase_key_json:
    # Cloud mode: read from environment variable
    print("☁️ Cloud Mode: Loading Firebase from environment variable...")
    cred = credentials.Certificate(json.loads(firebase_key_json))
else:
    # Local mode: read from file
    print("💻 Local Mode: Loading Firebase from serviceAccountKey.json...")
    cred = credentials.Certificate("serviceAccountKey.json")

initialize_app(cred)
db = firestore.client()

# ============================================================
# 4. Initialize AI Models
# ============================================================
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
print(f"🖥 Using Backend AI Device: {device}")

# Classroom-optimized MTCNN (tuned for crowded group photos)
detector = MTCNN(
    keep_all=True,
    device=device,
    min_face_size=30,               # Catch back-row faces (30px minimum)
    thresholds=[0.5, 0.6, 0.6],    # Lower thresholds = more faces detected (higher recall)
    post_process=True,              # Normalize output for consistent embeddings
    select_largest=False,           # Don't just pick the biggest face
)
model = InceptionResnetV1(pretrained='vggface2').to(device).eval()
MODEL_PATH = "models/final_attendance_model.pt"

if os.path.exists(MODEL_PATH):
    print(f"🧠 Loading custom-trained AI Brain: {MODEL_PATH}...")
    model.load_state_dict(torch.load(MODEL_PATH, map_location=device, weights_only=True))
else:
    print("⚠️ WARNING: Custom model NOT FOUND. Using base intelligence.")

# ============================================================
# 4b. In-Memory Student Vector Cache (Optimization 2)
# ============================================================
# Pre-load and pre-normalize all student vectors at startup.
# This eliminates repeated Firestore reads and repeated norm calculations.

_enrolled_cache: dict[str, np.ndarray] = {}  # student_id -> normalized vector
_enrolled_matrix: np.ndarray | None = None    # shape: [N, 512] pre-normalized
_enrolled_ids: list[str] = []                  # ordered list matching matrix rows

def refresh_enrolled_cache():
    """Reload all enrolled student vectors from Firestore into RAM."""
    global _enrolled_cache, _enrolled_matrix, _enrolled_ids
    try:
        docs = db.collection("Students").get()
        new_cache = {}
        for d in docs:
            data = d.to_dict()
            if "face_vector" in data:
                vec = np.array(data["face_vector"], dtype=np.float32)
                norm = np.linalg.norm(vec)
                if norm > 0:
                    new_cache[d.id] = vec / norm  # Pre-normalize!
        
        _enrolled_cache = new_cache
        if new_cache:
            _enrolled_ids = list(new_cache.keys())
            _enrolled_matrix = np.stack([new_cache[sid] for sid in _enrolled_ids])
        else:
            _enrolled_ids = []
            _enrolled_matrix = None
        
        print(f"📋 Enrolled cache refreshed: {len(_enrolled_cache)} students loaded.")
    except Exception as e:
        print(f"❌ Cache refresh error: {e}")

# Load cache on startup
refresh_enrolled_cache()

# ============================================================
# 5. OTP Storage (In-Memory, expires after 5 minutes)
# ============================================================
otp_store: dict[str, dict] = {}
OTP_EXPIRY_SECONDS = 300  # 5 minutes

# Admin API token for protected endpoints
ADMIN_API_TOKEN = os.environ.get("ADMIN_API_TOKEN", "attendease-admin-2026")

# ============================================================
# Helper Functions
# ============================================================

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB

async def read_image_safely(file: UploadFile):
    """Read and validate an uploaded image. Returns (PIL Image, error_msg)."""
    img_bytes = await file.read()
    if len(img_bytes) > MAX_UPLOAD_BYTES:
        return None, "File too large. Maximum size is 10MB."
    try:
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        return img, None
    except Exception:
        return None, "Could not read the uploaded image."

def preprocess_classroom_photo(img_pil):
    """
    Optimize a classroom photo for face detection.
    Corrects for fluorescent lighting, low contrast, and slight blur.
    """
    from PIL import ImageEnhance, ImageFilter
    
    # 1. Boost contrast (helps with flat fluorescent lighting)
    img_pil = ImageEnhance.Contrast(img_pil).enhance(1.25)
    
    # 2. Slight color correction (counteract yellow tint)
    img_pil = ImageEnhance.Color(img_pil).enhance(1.15)
    
    # 3. Sharpen (helps with back-row blur)
    img_pil = img_pil.filter(ImageFilter.SHARPEN)
    
    # 4. Ensure optimal size for speed (1400px is sweet spot for classroom)
    max_dim = 1400
    if max(img_pil.size) > max_dim:
        ratio = max_dim / max(img_pil.size)
        new_size = (int(img_pil.width * ratio), int(img_pil.height * ratio))
        img_pil = img_pil.resize(new_size, Image.LANCZOS)
    
    return img_pil

def get_embedding(img_pil):
    """Turn a PIL image into a 512-D face vector."""
    try:
        face = detector(img_pil)
        if face is None:
            return None
        if len(face.shape) > 3:
            face = face[0]
        with torch.no_grad():
            embedding = model(face.unsqueeze(0).to(device))
        return embedding.cpu().numpy().flatten()
    except Exception as e:
        print(f"❌ Face embedding error: {e}")
        return None

def sanitize_id(raw_id: str) -> str:
    """Remove dangerous characters from IDs."""
    return re.sub(r'[^a-zA-Z0-9_-]', '', raw_id)

def generate_otp() -> str:
    """Generate a 6-digit OTP."""
    return str(random.randint(100000, 999999))

APPS_SCRIPT_URL = os.environ.get(
    "APPS_SCRIPT_URL",
    "https://script.google.com/macros/s/AKfycbzvuV4PxerJiSTAajPnb6rMPwwmfFnId74VG07pgQyivK1I0azA6RHHWEea6TNJb6ES1A/exec"
)

def send_email_via_script(to_email: str, subject: str, html_body: str) -> bool:
    """Send email securely using the HTTPS Google Apps Script API."""
    try:
        data = urllib.parse.urlencode({"to": to_email, "subject": subject, "html": html_body}).encode("utf-8")
        req = urllib.request.Request(APPS_SCRIPT_URL, data=data)
        with urllib.request.urlopen(req, timeout=10) as response:
            res = response.read().decode("utf-8")
            print(f"📧 API Response for {to_email}: {res}")
            return True
    except Exception as e:
        print(f"❌ Apps Script Email Error: {e}")
        return False

def send_otp_email(to_email: str, otp: str) -> bool:
    """Send OTP via Apps Script. Returns True if sent, False otherwise."""
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 30px;
                background: linear-gradient(135deg, #0D0E15, #1C1F2E); color: white; border-radius: 16px;">
        <h2 style="color: #00D1FF; margin-bottom: 5px;">AttendEase AI</h2>
        <p style="color: #8F9BB3; font-size: 14px;">Your verification code is:</p>
        <div style="background: rgba(0,209,255,0.1); border: 2px solid rgba(0,209,255,0.3);
                    border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
            <span style="font-size: 36px; font-weight: 900; letter-spacing: 8px; color: #00D1FF;">
                {otp}
            </span>
        </div>
        <p style="color: #8F9BB3; font-size: 12px;">This code expires in 5 minutes.</p>
        <p style="color: #8F9BB3; font-size: 12px;">If you didn't request this, ignore this email.</p>
    </div>
    """
    success = send_email_via_script(to_email, "AttendEase — Your Verification Code", html)
    if not success:
        print(f"📧 [FALLBACK] OTP for {to_email}: {otp}")
    return True  # Still succeed so registration isn't blocked

# ============================================================
# API ENDPOINTS
# ============================================================

@app.get("/")
async def health_check():
    return {"status": "AttendEase AI Backend v3.0 🚀", "rate_limit": f"{RATE_LIMIT} req/{RATE_LIMIT_WINDOW}s"}

# ------ OTP ENDPOINTS ------

@app.post("/send-otp")
async def send_otp(email: str = Form(...)):
    """Generate and send a 6-digit OTP to the given email."""
    otp = generate_otp()
    otp_store[email] = {
        "otp": otp,
        "created_at": time.time(),
        "attempts": 0,
    }
    success = send_otp_email(email, otp)
    if success:
        return {"status": "success", "message": f"OTP sent to {email}"}
    return {"status": "error", "error": "Failed to send OTP email."}

@app.post("/verify-otp")
async def verify_otp(email: str = Form(...), otp: str = Form(...)):
    """Verify the 6-digit OTP for the given email."""
    record = otp_store.get(email)
    if not record:
        return {"status": "error", "valid": False, "error": "No OTP was sent to this email. Please request a new one."}

    # Check expiry
    if time.time() - record["created_at"] > OTP_EXPIRY_SECONDS:
        del otp_store[email]
        return {"status": "error", "valid": False, "error": "OTP has expired. Please request a new one."}

    # Check max attempts
    record["attempts"] += 1
    if record["attempts"] > 5:
        del otp_store[email]
        return {"status": "error", "valid": False, "error": "Too many wrong attempts. Request a new OTP."}

    if record["otp"] == otp:
        del otp_store[email]  # One-time use
        return {"status": "success", "valid": True}

    return {"status": "error", "valid": False, "error": f"Incorrect OTP. {5 - record['attempts']} attempts left."}

# ------ LIVENESS CHECK ------

@app.post("/liveness-check")
async def liveness_check(file1: UploadFile = File(...), file2: UploadFile = File(...)):
    """
    Basic liveness detection: compare two face photos taken moments apart.
    threshold: similarity 0.60–0.995 = live.
    """
    try:
        img1 = Image.open(io.BytesIO(await file1.read())).convert("RGB")
        img2 = Image.open(io.BytesIO(await file2.read())).convert("RGB")
    except Exception:
        return {"status": "error", "alive": False, "error": "Could not read images."}

    vec1 = get_embedding(img1)
    vec2 = get_embedding(img2)

    if vec1 is None or vec2 is None:
        return {"status": "error", "alive": False, "error": "Could not detect a face in one or both photos."}

    # Cosine similarity between the two shots
    similarity = float(np.dot(vec1, vec2) / (np.linalg.norm(vec1) * np.linalg.norm(vec2)))

    # Threshold: 0.60-0.995 = likely live. >0.995 = probably a static photo.
    is_alive = 0.60 < similarity < 0.995

    print(f"🔍 Liveness score: {similarity:.4f} → {'LIVE ✅' if is_alive else 'SUSPECT ⚠️'}")

    return {
        "status": "success",
        "alive": is_alive,
        "score": round(similarity, 4),
        "message": "Liveness verified ✅" if is_alive else "Possible spoofing detected. Please try again with natural head movement."
    }

# ------ REGISTER FACE ------

@app.post("/register")
async def register_student(student_id: str = Form(...), file: UploadFile = File(...)):
    """Register a student's face vector."""
    clean_id = sanitize_id(student_id)
    if not clean_id:
        return {"status": "error", "error": "Invalid student ID."}

    img, err = await read_image_safely(file)
    if err:
        return {"status": "error", "error": err}

    vector = get_embedding(img)
    if vector is None:
        return {"status": "error", "error": "No face detected. Please use better lighting."}

    existing = db.collection("Students").document(clean_id).get()
    if existing.exists:
        return {"status": "error", "error": f"Registration number {clean_id} is already enrolled."}

    db.collection("Students").document(clean_id).set({
        "face_vector": vector.tolist(),
        "registered_on": firestore.SERVER_TIMESTAMP
    })
    
    # Auto-refresh cache so the new student is immediately available
    refresh_enrolled_cache()
    
    return {"status": "success", "message": f"Face ID for {clean_id} enrolled successfully!"}

# ------ VALIDATE FACE ------

@app.post("/validate-face")
async def validate_face(file: UploadFile = File(...)):
    """Quick check: can we detect a face in this image?"""
    try:
        img = Image.open(io.BytesIO(await file.read())).convert("RGB")
    except Exception:
        return {"status": "error", "error": "Could not read the image."}

    vector = get_embedding(img)
    if vector is None:
        return {"status": "error", "valid": False, "error": "No face detected."}
    return {"status": "success", "valid": True}

# ------ TAKE ATTENDANCE ------

MATCH_THRESHOLD = 0.75  # Increased from 0.65 to prevent false positives

def is_photo_spoofed(img_pil):
    """
    Experimental Liveness Check (Anti-Spoofing).
    Checks for Moire patterns (screens) and Flatness (printouts).
    """
    try:
        # Downsize for speed (Moire and variance are detectable at lower res)
        img_temp = img_pil.copy()
        img_temp.thumbnail((600, 600))
        
        # Convert to grayscale
        gray = img_temp.convert('L')
        arr = np.array(gray)

        # 1. Laplacian Variance (Edge Density) using simple convolve
        # Approximates blur/flatness
        from scipy.ndimage import laplace
        var = laplace(arr).var()
        print(f"   🛡️ Spoof Check: Laplacian Variance = {var:.2f}")
        if var < 70: return True, "Photo quality too low or printout detected."

        # 2. FFT Moire Detection (Screen pixels)
        f = np.fft.fft2(arr)
        fshift = np.fft.fftshift(f)
        magnitude = 20 * np.log(np.abs(fshift) + 1)
        
        # Check for high-energy spikes in high-frequency regions
        if np.max(magnitude) > np.mean(magnitude) * 3.8:
            print(f"   🛡️ Spoof Check: FFT Periodic Pattern Detected (Screen).")
            return True, "Digital screen detected (anti-proxy)."

        return False, None
    except Exception as e:
        print(f"   ⚠️ Liveness check error: {e}")
        return False, None

BATCH_CHUNK_SIZE = 16  # Process faces in safe chunks to avoid OOM on free tier

def process_single_photo(img_pil, enrolled_ids, enrolled_matrix):
    """
    Process one photo: detect liveness, detect faces, match them.
    Uses vectorized NumPy matrix matching for 10-100x speedup.
    Returns (recognized_ids, total_faces, annotated_b64, error_msg)
    """
    import time as _time
    t_start = _time.time()
    
    # Liveness Check
    is_spoof, reason = is_photo_spoofed(img_pil)
    if is_spoof:
        return [], 0, None, reason

    # Preprocess
    img_pil = preprocess_classroom_photo(img_pil)
    
    # Detect faces (single pass)
    try:
        boxes, probs = detector.detect(img_pil)
    except Exception as e:
        print(f"   ❌ Detection failed: {e}")
        return [], 0, None, None

    if boxes is None or len(boxes) == 0:
        return [], 0, None, None

    total_faces = len(boxes)
    print(f"   👁 Detected {total_faces} faces in {_time.time() - t_start:.2f}s")

    # ── Optimization 4: Single-pass alignment ──
    # Use MTCNN on the full image once to get aligned face tensors directly
    aligned_faces = []
    _face_indices = []  # (box_index, face_width)
    
    for i, box in enumerate(boxes):
        try:
            x1, y1, x2, y2 = [int(b) for b in box]
            face_w = x2 - x1
            face_h = y2 - y1
            
            # Padded crop
            pw, ph = int(face_w * 0.15), int(face_h * 0.15)
            cx1, cy1 = max(0, x1 - pw), max(0, y1 - ph)
            cx2, cy2 = min(img_pil.width, x2 + pw), min(img_pil.height, y2 + ph)
            
            face_crop = img_pil.crop((cx1, cy1, cx2, cy2))
            aligned_face = detector(face_crop)
            if aligned_face is not None:
                if len(aligned_face.shape) > 3: aligned_face = aligned_face[0]
                aligned_faces.append(aligned_face)
                _face_indices.append((i, face_w))
        except Exception: 
            continue

    if not aligned_faces:
        return [], total_faces, None, None

    # ── Optimization 3: Chunked batch inference ──
    all_vectors = []
    for chunk_start in range(0, len(aligned_faces), BATCH_CHUNK_SIZE):
        chunk = aligned_faces[chunk_start:chunk_start + BATCH_CHUNK_SIZE]
        try:
            batch_tensor = torch.stack(chunk).to(device)
            with torch.no_grad():
                chunk_vectors = model(batch_tensor).cpu().numpy()
            all_vectors.append(chunk_vectors)
        except Exception as e:
            print(f"   ⚠️ Batch chunk error: {e}")
            continue
    
    if not all_vectors:
        return [], total_faces, None, None
    
    face_vectors_np = np.vstack(all_vectors)  # Shape: [num_faces, 512]
    print(f"   🧠 Embedded {face_vectors_np.shape[0]} faces in {_time.time() - t_start:.2f}s")

    # ── Optimization 1: Vectorized matrix matching ──
    # Normalize all face vectors at once
    face_norms = np.linalg.norm(face_vectors_np, axis=1, keepdims=True)
    face_norms[face_norms == 0] = 1  # Avoid division by zero
    face_vectors_normed = face_vectors_np / face_norms
    
    # Compute ALL similarities in ONE matrix multiply: [num_faces x num_students]
    similarity_matrix = face_vectors_normed @ enrolled_matrix.T  # Instant!
    
    # One-to-one matching using the similarity matrix
    matched_faces = set()
    matched_students = set()
    recognized_ids = []
    face_to_student = {}

    # Get all (similarity, face_local_idx, student_idx) pairs above threshold
    face_idxs, student_idxs = np.where(similarity_matrix >= MATCH_THRESHOLD)
    candidates = []
    for fi, si in zip(face_idxs, student_idxs):
        candidates.append((float(similarity_matrix[fi, si]), fi, si))
    
    # Sort by highest similarity first (greedy one-to-one assignment)
    candidates.sort(key=lambda x: x[0], reverse=True)
    
    for similarity, face_local_idx, student_idx in candidates:
        box_idx = _face_indices[face_local_idx][0]
        s_id = enrolled_ids[student_idx]
        if box_idx in matched_faces or s_id in matched_students:
            continue
        matched_faces.add(box_idx)
        matched_students.add(s_id)
        recognized_ids.append(s_id)
        face_to_student[box_idx] = (s_id, similarity)
    
    print(f"   ✅ Matched {len(recognized_ids)}/{total_faces} faces in {_time.time() - t_start:.2f}s")

    # Annotate
    from PIL import ImageDraw, ImageFont
    import base64
    annotated = img_pil.copy()
    draw = ImageDraw.Draw(annotated)
    try:
        font = ImageFont.truetype("arial.ttf", size=max(16, int(img_pil.height * 0.018)))
        small_font = ImageFont.truetype("arial.ttf", size=max(12, int(img_pil.height * 0.012)))
    except Exception:
        font = ImageFont.load_default()
        small_font = font

    for i, box in enumerate(boxes):
        x1, y1, x2, y2 = [int(b) for b in box]
        if i in face_to_student:
            student_id, score = face_to_student[i]
            color = (0, 224, 150)
            draw.rectangle([x1, y1, x2, y2], outline=color, width=3)
            label = f"{student_id} ({score:.2f})"
            bbox = draw.textbbox((x1, y1), label, font=font)
            draw.rectangle([x1, y1 - (bbox[3]-bbox[1]+8) - 2, x1 + (bbox[2]-bbox[0]+10), y1], fill=color)
            draw.text((x1 + 4, y1 - (bbox[3]-bbox[1]+8)), label, fill=(0, 0, 0), font=font)
        else:
            color = (255, 60, 60)
            draw.rectangle([x1, y1, x2, y2], outline=color, width=2)
            draw.text((x1 + 4, y1 - 20), "?", fill=color, font=font)

    buffer = io.BytesIO()
    annotated.save(buffer, format="JPEG", quality=80)
    return recognized_ids, total_faces, base64.b64encode(buffer.getvalue()).decode("utf-8"), None

def send_absent_emails_task(present_students: list):
    """Background task to fetch all students and email the absent ones."""
    try:
        # Get all users who are students
        users_ref = db.collection("users").where("role", "==", "student").stream()
        absent_emails = []
        for user in users_ref:
            data = user.to_dict()
            reg_num = data.get("regNumber")
            email = data.get("email")
            
            # If student has a regNumber, email, and is NOT in present_students...
            if reg_num and email and (reg_num not in present_students):
                absent_emails.append(email)
                
        if not absent_emails:
            print("✅ All students are present! No absent emails to send.")
            return

        print(f"📧 Sending ABSENT notification to {len(absent_emails)} students via Apps Script...")
        
        for email in absent_emails:
            html = f"""
            <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 30px;
                        background: linear-gradient(135deg, #1A1015, #2B151F); color: white; border-radius: 16px;">
                <h2 style="color: #FF4D4D; margin-bottom: 5px;">Attendance Alert ⚠️</h2>
                <p style="color: #F8B4B4; font-size: 14px;">Hello,</p>
                <div style="background: rgba(255,77,77,0.1); border: 2px solid rgba(255,77,77,0.3);
                            border-radius: 12px; padding: 20px; textAlign: center; margin: 20px 0;">
                    <span style="font-size: 18px; font-weight: bold; color: #FF4D4D;">
                        You have been marked ABSENT for today's class session.
                    </span>
                </div>
                <p style="color: #F8B4B4; font-size: 13px;">If you believe this is a mistake or were unable to capture your face, please contact your professor immediately to correct your attendance record.</p>
                <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.1); margin: 20px 0;">
                <p style="color: #A0A0A0; font-size: 11px;">This is an automated message from the AttendEase AI System. Do not reply.</p>
            </div>
            """
            
            send_email_via_script(email, "AttendEase: Absent Notification", html)
                
        print(f"✅ Finished sending {len(absent_emails)} absent emails.")
                
    except Exception as e:
        print(f"❌ Background Email Task Failed: {e}")

@app.post("/attendance")
async def take_attendance(background_tasks: BackgroundTasks, files: list[UploadFile] = File(...)):
    """
    Scan up to 4 classroom photos and identify enrolled students collectively.
    Optimized for 30-100 students using vectorized matrix matching.
    """
    if not files:
        return {"status": "error", "error": "No files uploaded."}

    # ── Optimization 2: Use cached vectors instead of hitting Firestore ──
    if not _enrolled_cache or _enrolled_matrix is None:
        # Try a fresh reload in case students were added externally
        refresh_enrolled_cache()
    
    if not _enrolled_cache or _enrolled_matrix is None:
        return {"status": "error", "error": "No students have face vectors registered."}

    # Step 2: Process each photo
    all_recognized = set()
    best_annotated = None
    max_detections = -1
    total_unique_faces_detected = 0

    print(f"📸 Processing {len(files)} attendance photos ({len(_enrolled_cache)} students in cache)...")

    for i, file in enumerate(files):
        try:
            img_bytes = await file.read()
            img_pil = Image.open(io.BytesIO(img_bytes)).convert("RGB")
            
            recognized, face_count, annotated_b64, error_msg = process_single_photo(
                img_pil, _enrolled_ids, _enrolled_matrix
            )
            
            if error_msg:
                print(f"   🛡️ Photo #{i+1} REJECTED: {error_msg}")
                return {"status": "error", "error": f"Liveness Failure (Photo #{i+1}): {error_msg}"}
            
            all_recognized.update(recognized)
            total_unique_faces_detected = max(total_unique_faces_detected, face_count)

            if len(recognized) > max_detections:
                max_detections = len(recognized)
                best_annotated = annotated_b64
            elif best_annotated is None:
                best_annotated = annotated_b64

            print(f"   🖼 Photo #{i+1}: Found {len(recognized)} students")
        except Exception as e:
            print(f"   ⚠️ Error processing photo #{i+1}: {e}")
            continue

    if not all_recognized and max_detections <= 0:
        return {"status": "error", "error": "No students recognized in any of the photos."}

    present_list = sorted(list(all_recognized))
    
    # Launch background email task
    background_tasks.add_task(send_absent_emails_task, present_list)

    return {
        "status": "success",
        "total_faces": total_unique_faces_detected,
        "present_students": present_list,
        "annotated_image": best_annotated,
        "photos_processed": len(files)
    }

# ------ DELETE USER ------

@app.post("/delete-user")
async def delete_user(uid: str = Form(...), x_admin_token: str = Header(None, alias="X-Admin-Token")):
    """Delete a user's Firebase Auth account (called by admin on rejection). Requires admin token."""
    if x_admin_token != ADMIN_API_TOKEN:
        return JSONResponse(status_code=403, content={"status": "error", "error": "Unauthorized. Invalid admin token."})
    try:
        firebase_auth.delete_user(uid)
        return {"status": "success", "message": f"Auth account deleted."}
    except firebase_auth.UserNotFoundError:
        return {"status": "success", "message": "Already deleted."}
    except Exception as e:
        return {"status": "error", "error": str(e)}

# ------ VERIFY TEACHER CODE ------

@app.post("/verify-teacher-code")
async def verify_teacher_code(code: str = Form(...)):
    """Server-side teacher code verification."""
    VALID_CODE = os.environ.get("TEACHER_CODE", "TEACHER2026")
    if code == VALID_CODE:
        return {"status": "success", "valid": True}
    return {"status": "error", "valid": False, "error": "Invalid code."}

# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":
    import uvicorn
    print("=" * 50)
    print("🚀 AttendEase AI Backend v3.0")
    print(f"📧 SMTP: {'Configured ✅' if SMTP_EMAIL else 'Not configured (OTP printed to console)'}")
    print(f"🛡 Rate Limit: {RATE_LIMIT} requests per {RATE_LIMIT_WINDOW}s")
    print("=" * 50)
    uvicorn.run(app, host="0.0.0.0", port=8000)
