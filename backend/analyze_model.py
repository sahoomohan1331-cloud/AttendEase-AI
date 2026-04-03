"""
AttendEase AI — Model Analyzer
Inspects the trained model file and compares it to base pretrained weights.
"""
import os
import torch
import numpy as np
from facenet_pytorch import InceptionResnetV1

MODEL_PATH = "models/final_attendance_model.pt"

print("=" * 60)
print("🔬 AttendEase AI — Model Deep Analysis")
print("=" * 60)

# --- 1. File Info ---
file_size_mb = os.path.getsize(MODEL_PATH) / 1024 / 1024
print(f"\n📁 File: {MODEL_PATH}")
print(f"📦 Size: {file_size_mb:.1f} MB")

# --- 2. Load custom model weights ---
custom_state = torch.load(MODEL_PATH, map_location="cpu")
print(f"🔑 Total weight keys: {len(custom_state)}")

# Show layer structure
layer_types = {}
for key in custom_state:
    parts = key.split(".")
    layer_name = parts[0]
    layer_types[layer_name] = layer_types.get(layer_name, 0) + 1

print(f"\n📐 Architecture Breakdown ({len(layer_types)} top-level layers):")
for name, count in sorted(layer_types.items()):
    print(f"   {name}: {count} parameters")

# --- 3. Compare with base VGGFace2 pretrained weights ---
print("\n🔍 Comparing custom model vs. base VGGFace2 pretrained weights...")
base_model = InceptionResnetV1(pretrained="vggface2")
base_state = base_model.state_dict()

matching_keys = sum(1 for k in custom_state if k in base_state)
print(f"   Keys in custom: {len(custom_state)}")
print(f"   Keys in base:   {len(base_state)}")
print(f"   Matching keys:  {matching_keys}")

identical = 0
different = 0
max_diff = 0
most_changed_layer = ""

for key in custom_state:
    if key in base_state:
        if torch.equal(custom_state[key], base_state[key]):
            identical += 1
        else:
            different += 1
            diff = (custom_state[key].float() - base_state[key].float()).abs().mean().item()
            if diff > max_diff:
                max_diff = diff
                most_changed_layer = key

print(f"\n📊 Weight Comparison Results:")
print(f"   ✅ Identical weights:  {identical}/{matching_keys}")
print(f"   🔄 Modified weights:  {different}/{matching_keys}")

if different == 0:
    print(f"\n⚠️  FINDING: The custom model is IDENTICAL to the base VGGFace2 model.")
    print(f"   The 'final_attendance_model.pt' file contains the same weights as")
    print(f"   the pretrained model. No fine-tuning has been applied.")
    print(f"   Accuracy = VGGFace2 baseline (~99.2% on LFW benchmark)")
else:
    pct_changed = (different / matching_keys) * 100
    print(f"   📏 Percentage modified: {pct_changed:.1f}%")
    print(f"   📈 Most-changed layer: {most_changed_layer}")
    print(f"   📈 Max average diff:   {max_diff:.6f}")
    
    if pct_changed < 5:
        print(f"\n   FINDING: Only {pct_changed:.1f}% of layers were fine-tuned.")
        print(f"   This is a lightly fine-tuned model. Accuracy ≈ VGGFace2 baseline.")
    elif pct_changed < 50:
        print(f"\n   FINDING: {pct_changed:.1f}% of layers were fine-tuned.")
        print(f"   This is a moderately customized model.")
    else:
        print(f"\n   FINDING: {pct_changed:.1f}% of layers differ from base.")
        print(f"   This is a heavily fine-tuned or retrained model.")

# --- 4. Model Architecture Info ---
print(f"\n🏗️ Model Architecture:")
print(f"   Type: InceptionResnetV1 (FaceNet)")
print(f"   Input: 160×160 RGB face images")
print(f"   Output: 512-dimensional embedding vector")
print(f"   Pretrained on: VGGFace2 dataset (3.31M images, 9131 identities)")

# --- 5. Parameter Count ---
total_params = sum(p.numel() for p in base_model.parameters())
trainable_params = sum(p.numel() for p in base_model.parameters() if p.requires_grad)
print(f"   Total parameters: {total_params:,}")
print(f"   Trainable params: {trainable_params:,}")

# --- 6. Vector space analysis ---
print(f"\n📏 Embedding Space Analysis:")
total_weight_norm = 0
count = 0
for key, val in custom_state.items():
    if val.dtype in [torch.float32, torch.float16]:
        total_weight_norm += val.float().norm().item()
        count += 1
avg_norm = total_weight_norm / count if count else 0
print(f"   Average layer L2 norm: {avg_norm:.4f}")
print(f"   Embedding dimension:   512")
print(f"   Similarity metric:     Cosine similarity")
print(f"   Match threshold:       0.50 (in attendance endpoint)")

print("\n" + "=" * 60)
print("✅ Analysis Complete")
print("=" * 60)
