import React, { useState, useEffect } from 'react';
import { StatusBar, ActivityIndicator, View, Alert } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import * as Updates from 'expo-updates';
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
import UpdateScreen from './components/UpdateScreen';

// Current App Version (Sync with app.json)
const APP_VERSION = "3.1.0";

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
  const [updateConfig, setUpdateConfig] = useState<{ 
    latestVersion: string, updateUrl: string, isMandatory: boolean 
  } | null>(null);
  const [dismissUpdate, setDismissUpdate] = useState(false);

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

    // Check for Remote Updates (Manual APK Link)
    const checkRemoteUpdate = async () => {
      try {
        const configDoc = await getDoc(doc(db, 'app_config', 'android'));
        if (configDoc.exists()) {
          const data = configDoc.data();
          if (data.latest_version && data.latest_version !== APP_VERSION) {
            setUpdateConfig({
              latestVersion: data.latest_version,
              updateUrl: data.update_url || '',
              isMandatory: data.is_mandatory ?? false
            });
          }
        }
      } catch (err) {
        console.warn('Manual update check failed:', err);
      }
    };

    // Check for Expo OTA Updates (Seamless)
    const checkOTAUpdate = async () => {
      if (__DEV__) return; // Skip in development
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
          Alert.alert(
            '🆕 Update Available',
            'A new version of AttendEase AI is ready. Restart now to see the new changes?',
            [
              { text: 'Later', style: 'cancel' },
              { text: 'Restart Now', onPress: () => Updates.reloadAsync() }
            ]
          );
        }
      } catch (e) {
        console.warn('OTA Update Check Failed:', e);
      }
    };

    checkRemoteUpdate();
    checkOTAUpdate();

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

    // Force Update Screen
    if (updateConfig && !dismissUpdate) {
      return (
        <UpdateScreen 
          latestVersion={updateConfig.latestVersion}
          updateUrl={updateConfig.updateUrl}
          isMandatory={updateConfig.isMandatory}
          onDismiss={() => setDismissUpdate(true)}
        />
      );
    }

    if (!user) return <AuthScreen />;
    if (!userData) return <AuthScreen />;
    if (!userData.approved && userData.role !== 'super-admin') return <PendingScreen onApproved={async () => {
      // Re-fetch user data from Firestore to update the approved status
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setUserData({
            role: data.role || 'student',
            approved: data.approved ?? false,
            fullName: data.fullName || '',
            email: data.email || user.email || '',
            regNumber: data.regNumber || '',
            department: data.department || '',
            batchYear: data.batchYear || '',
            faceRegistered: data.faceRegistered || false,
            createdAt: data.createdAt || '',
          });
        }
      } catch (e) { console.error('Refresh failed:', e); }
    }} />;

    switch (currentScreen) {
      case 'home':
        return <HomeScreen onNavigate={setCurrentScreen} userRole={userData.role} regNumber={userData.regNumber} appVersion={APP_VERSION} />;
      case 'register':
        return <RegisterScreen onBack={() => setCurrentScreen('home')} />;
      case 'attendance':
        return <AttendanceScreen onBack={() => setCurrentScreen('home')} />;
      case 'history':
        return <AttendanceHistory onBack={() => setCurrentScreen('home')} userRegNumber={userData.regNumber} />;
      case 'admin':
        return <AdminDashboard onBack={() => setCurrentScreen('home')} />;
      case 'profile':
        return <ProfileScreen onBack={() => setCurrentScreen('home')} userData={userData} appVersion={APP_VERSION} />;
      case 'report':
        return <AttendanceReport onBack={() => setCurrentScreen('home')} />;
      default:
        return <HomeScreen onNavigate={setCurrentScreen} userRole={userData.role} regNumber={userData.regNumber} appVersion={APP_VERSION} />;
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
