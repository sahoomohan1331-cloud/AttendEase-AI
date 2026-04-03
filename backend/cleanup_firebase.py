import firebase_admin
from firebase_admin import credentials, firestore, auth

# 1. Initialize Admin SDK
cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

def clear_collection(collection_name):
    print(f"🧹 Clearing collection: {collection_name}...")
    docs = db.collection(collection_name).stream()
    count = 0
    for doc in docs:
        doc.reference.delete()
        count += 1
    print(f"✅ Deleted {count} documents from {collection_name}.")

def clear_auth_users():
    print("👤 Clearing all users from Firebase Authentication...")
    count = 0
    # List all users (up to 1000)
    users = auth.list_users().users
    for user in users:
        auth.delete_user(user.uid)
        count += 1
    print(f"✅ Successfully deleted {count} users from Auth.")

if __name__ == "__main__":
    print("🚀 STARTING DATABASE CLEANUP...")
    
    # Clear Firestore Collections
    clear_collection("users")
    clear_collection("Students")
    
    # Clear Auth
    clear_auth_users()
    
    print("\n✨ YOUR FIREBASE IS NOW FRESH AND CLEAN! ✨")
    print("You can now start the app and register as the first Super-Admin.")
