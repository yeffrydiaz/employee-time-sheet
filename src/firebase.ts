import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-timesheet-project',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:000000000000:web:000000000000',
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyDemoPlaceholderKeyForLocalDev00000',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'demo-timesheet-project.firebaseapp.com',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'demo-timesheet-project.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const dbId = import.meta.env.VITE_FIREBASE_DATABASE_ID;
export const db = getFirestore(app, dbId && dbId !== 'default' ? dbId : undefined);
export const googleProvider = new GoogleAuthProvider();
export const isFirebaseConfigured = Boolean(import.meta.env.VITE_FIREBASE_API_KEY);
