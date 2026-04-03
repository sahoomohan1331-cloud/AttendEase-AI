import firebase_admin
from firebase_admin import credentials, firestore

def promote_user(email):
    # Initialize Firebase if not already
    if not firebase_admin._apps:
        cred = credentials.Certificate("serviceAccountKey.json")
        firebase_admin.initialize_app(cred)
    
    db = firestore.client()
    users_ref = db.collection("users")
    
    # Query for the user by email
    query = users_ref.where("email", "==", email).stream()
    
    found = False
    for doc in query:
        found = True
        doc_ref = users_ref.document(doc.id)
        doc_ref.update({
            "role": "super-admin",
            "approved": True
        })
        print(f"✅ SUCCESS: {email} (ID: {doc.id}) has been promoted to Super-Admin!")
    
    if not found:
        print(f"❌ ERROR: User with email {email} not found in the 'users' collection.")

if __name__ == "__main__":
    email_to_promote = "mohan39338@gmail.com"
    promote_user(email_to_promote)
