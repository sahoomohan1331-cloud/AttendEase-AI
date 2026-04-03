import React, { useState, useEffect } from 'react';
import { StatusBar, ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebaseConfig';
import { colors, globalStyles } from './styles';

// Screens
import SplashScreen from './components/SplashScreen';
import ErrorBoundary from './components/ErrorBoundary';
import AuthScreen from './components/AuthScreen';
import PendingScreen from './components/PendingScreen';
import HomeScreen from './components/HomeScreen';
import RegisterScreen from './components/RegisterScreen';
import AttendanceScreen from './components/AttendanceScreen';
import AttendanceHistory from './components/AttendanceHistory';
import AdminDashboard from './components/AdminDashboard';
import ProfileScreen from './components/ProfileScreen';
import AttendanceReport from './components/AttendanceReport';

export type Screen = 'home' | 'register' | 'attendance' | 'admin' | 'history' | 'profile' | 'report';

interface UserData {
  role: 'teacher' | 'student' | 'super-admin';
  approved: boolean;
  fullName: string;
  email: string;
  regNumber: string;
  department: string;
  batchYear: string;
  faceRegistered: boolean;
  createdAt: string;
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [user, setUser] = useState<any>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            setUserData({
              role: data.role || 'student',
              approved: data.approved ?? false,
              fullName: data.fullName || '',
              email: data.email || firebaseUser.email || '',
              regNumber: data.regNumber || '',
              department: data.department || '',
              batchYear: data.batchYear || '',
              faceRegistered: data.faceRegistered || false,
              createdAt: data.createdAt || '',
            });
          } else {
            setUserData(null);
          }
        } catch (error) {
          console.error('Error fetching user data:', error);
          setUserData(null);
        }
      } else {
        setUser(null);
        setUserData(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Show splash screen on startup
  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  const renderScreen = () => {
    if (loading) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }

    if (!user) return <AuthScreen />;
    if (!userData) return <AuthScreen />;
    if (!userData.approved && userData.role !== 'super-admin') return <PendingScreen />;

    switch (currentScreen) {
      case 'home':
        return <HomeScreen onNavigate={setCurrentScreen} userRole={userData.role} regNumber={userData.regNumber} />;
      case 'register':
        return <RegisterScreen onBack={() => setCurrentScreen('home')} />;
      case 'attendance':
        return <AttendanceScreen onBack={() => setCurrentScreen('home')} />;
      case 'history':
        return <AttendanceHistory onBack={() => setCurrentScreen('home')} userRegNumber={userData.regNumber} />;
      case 'admin':
        return <AdminDashboard onBack={() => setCurrentScreen('home')} />;
      case 'profile':
        return <ProfileScreen onBack={() => setCurrentScreen('home')} userData={userData} />;
      case 'report':
        return <AttendanceReport onBack={() => setCurrentScreen('home')} />;
      default:
        return <HomeScreen onNavigate={setCurrentScreen} userRole={userData.role} regNumber={userData.regNumber} />;
    }
  };

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <SafeAreaView style={globalStyles.container}>
          <StatusBar barStyle="light-content" backgroundColor={colors.background} />
          {renderScreen()}
        </SafeAreaView>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
