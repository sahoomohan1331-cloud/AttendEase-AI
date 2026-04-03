import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { colors, globalStyles } from '../styles';

const PendingScreen = () => {
  const [checking, setChecking] = useState(false);

  // Auto-check every 15 seconds
  useEffect(() => {
    const interval = setInterval(checkApproval, 15000);
    return () => clearInterval(interval);
  }, []);

  const checkApproval = async () => {
    if (!auth.currentUser) return;
    setChecking(true);
    try {
      const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
      if (userDoc.exists() && userDoc.data().approved) {
        // Force reload by signing out and back in
        Alert.alert('🎉 Approved!', 'Your account has been approved! The app will refresh now.', [
          { text: 'OK', onPress: () => {
            // Trigger a re-render by reloading auth state
            auth.currentUser?.reload();
            // Force state refresh
            window?.location?.reload?.();
          }}
        ]);
      }
    } catch (err) {
      // Silent fail — will retry in 15s
    } finally {
      setChecking(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      Alert.alert('Error', 'Could not log out.');
    }
  };

  return (
    <View style={[globalStyles.container, { justifyContent: 'center', alignItems: 'center', padding: 30 }]}>
      {/* Lock Icon */}
      <View style={{
        width: 100, height: 100, borderRadius: 50,
        backgroundColor: 'rgba(0, 209, 255, 0.1)',
        justifyContent: 'center', alignItems: 'center',
        marginBottom: 30,
        borderWidth: 2, borderColor: 'rgba(0, 209, 255, 0.2)',
      }}>
        <Text style={{ fontSize: 42 }}>⏳</Text>
      </View>

      <Text style={{
        color: colors.text, fontSize: 24, fontWeight: '800',
        textAlign: 'center', marginBottom: 12,
      }}>
        Awaiting Approval
      </Text>

      <Text style={{
        color: colors.textMuted, fontSize: 15,
        textAlign: 'center', lineHeight: 22, marginBottom: 30,
        paddingHorizontal: 10,
      }}>
        Your registration has been submitted successfully. The administrator will review and approve your account shortly.
      </Text>

      <View style={[globalStyles.card, { width: '100%', alignItems: 'center' }]}>
        <Text style={{ color: colors.textMuted, fontSize: 12, letterSpacing: 1 }}>STATUS</Text>
        <Text style={{ color: '#FFB800', fontSize: 18, fontWeight: '700', marginTop: 8 }}>
          PENDING REVIEW
        </Text>
        {checking && (
          <View style={{ flexDirection: 'row', marginTop: 12, alignItems: 'center' }}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={{ color: colors.textMuted, fontSize: 12, marginLeft: 8 }}>Checking...</Text>
          </View>
        )}
      </View>

      {/* Manual Check */}
      <TouchableOpacity
        style={[globalStyles.button, { width: '100%', marginTop: 20 }]}
        onPress={checkApproval}
        disabled={checking}
      >
        <Text style={globalStyles.buttonText}>↻ CHECK STATUS</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[globalStyles.button, {
          width: '100%', marginTop: 10,
          backgroundColor: 'transparent',
          borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
        }]}
        onPress={handleLogout}
      >
        <Text style={[globalStyles.buttonText, { color: colors.textMuted }]}>LOG OUT</Text>
      </TouchableOpacity>

      <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 20, opacity: 0.5 }}>
        Auto-checking every 15 seconds
      </Text>
    </View>
  );
};

export default PendingScreen;
