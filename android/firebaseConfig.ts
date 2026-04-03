import { initializeApp } from 'firebase/app';
// @ts-ignore: getReactNativePersistence exists at runtime in React Native builds
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: "AIzaSyDMGHT6C6mU3rOvyrNs_7eopibGdTxlzgc",
  authDomain: "attendease-33355.firebaseapp.com",
  projectId: "attendease-33355",
  storageBucket: "attendease-33355.firebasestorage.app",
  messagingSenderId: "1018484898724",
  appId: "1:1018484898724:web:7150357b40ce339b1b9f31"
};

const app = initializeApp(firebaseConfig);

const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage)
});

const db = getFirestore(app);

export { auth, db };
