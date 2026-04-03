import React from 'react';
import { View, Text, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { signOut } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import { colors, globalStyles } from '../styles';

interface ProfileScreenProps {
  onBack: () => void;
  userData: {
    fullName: string;
    email: string;
    role: string;
    regNumber: string;
    department: string;
    batchYear: string;
    faceRegistered: boolean;
    createdAt: string;
  };
}

const ProfileScreen: React.FC<ProfileScreenProps> = ({ onBack, userData }) => {
  const handleLogout = async () => {
    Alert.alert('Logout', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out', style: 'destructive',
        onPress: async () => {
          try { await signOut(auth); } catch (e) { Alert.alert('Error', 'Could not log out.'); }
        },
      },
    ]);
  };

  const getRoleBadge = () => {
    const config = {
      'super-admin': { bg: 'rgba(255, 0, 85, 0.15)', color: colors.secondary, label: 'SUPER ADMIN' },
      'teacher': { bg: 'rgba(0, 209, 255, 0.15)', color: colors.primary, label: 'TEACHER' },
      'student': { bg: 'rgba(0, 224, 150, 0.15)', color: colors.success, label: 'STUDENT' },
    };
    return config[userData.role as keyof typeof config] || config.student;
  };

  const badge = getRoleBadge();
  const joinDate = userData.createdAt ? new Date(userData.createdAt).toLocaleDateString('en-IN', {
    year: 'numeric', month: 'long', day: 'numeric'
  }) : 'Unknown';

  return (
    <ScrollView style={globalStyles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      {/* Header */}
      <TouchableOpacity onPress={onBack}>
        <Text style={{ color: colors.primary, fontSize: 16 }}>← Back to Dashboard</Text>
      </TouchableOpacity>

      {/* Profile Card */}
      <View style={[globalStyles.card, { marginTop: 20, alignItems: 'center', paddingVertical: 30 }]}>
        {/* Avatar */}
        <View style={{
          width: 80, height: 80, borderRadius: 40,
          backgroundColor: 'rgba(0, 209, 255, 0.15)',
          justifyContent: 'center', alignItems: 'center',
          marginBottom: 16,
          borderWidth: 2, borderColor: 'rgba(0, 209, 255, 0.3)',
        }}>
          <Text style={{ fontSize: 36 }}>
            {userData.role === 'teacher' || userData.role === 'super-admin' ? '👨‍🏫' : '🎓'}
          </Text>
        </View>

        <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800' }}>
          {userData.fullName}
        </Text>

        <View style={{
          backgroundColor: badge.bg,
          paddingHorizontal: 14, paddingVertical: 5, borderRadius: 8,
          marginTop: 8,
        }}>
          <Text style={{ color: badge.color, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>
            {badge.label}
          </Text>
        </View>
      </View>

      {/* Details */}
      <View style={[globalStyles.card, { marginTop: 12 }]}>
        <Text style={{ color: colors.textMuted, fontSize: 12, letterSpacing: 1, marginBottom: 16 }}>
          ACCOUNT DETAILS
        </Text>

        {[
          { icon: '📧', label: 'Email', value: userData.email },
          { icon: '🆔', label: 'Reg. Number', value: userData.regNumber },
          { icon: '🏛', label: 'Department', value: userData.department },
          { icon: '📅', label: 'Batch', value: userData.batchYear },
          { icon: '📸', label: 'Face ID', value: userData.faceRegistered ? 'Enrolled ✅' : (userData.role === 'teacher' ? 'Not Required' : 'Missing ⚠️') },
          { icon: '📆', label: 'Joined', value: joinDate },
        ].map((item) => (
          <View key={item.label} style={{
            flexDirection: 'row', alignItems: 'center',
            paddingVertical: 14,
            borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)',
          }}>
            <Text style={{ fontSize: 18, marginRight: 12 }}>{item.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.textMuted, fontSize: 11 }}>{item.label}</Text>
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600', marginTop: 2 }}>
                {item.value || '—'}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/* App Info */}
      <View style={[globalStyles.card, { marginTop: 12 }]}>
        <Text style={{ color: colors.textMuted, fontSize: 12, letterSpacing: 1, marginBottom: 12 }}>
          ABOUT APP
        </Text>
        <Text style={{ color: colors.text, fontSize: 14 }}>AttendEase AI</Text>
        <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>Version 2.0 — Sprint 2</Text>
        <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>AI-Powered Attendance System</Text>
      </View>

      {/* Logout */}
      <TouchableOpacity
        style={[globalStyles.button, {
          marginTop: 20,
          backgroundColor: 'rgba(255, 61, 113, 0.1)',
          borderWidth: 1, borderColor: colors.error,
        }]}
        onPress={handleLogout}
      >
        <Text style={[globalStyles.buttonText, { color: colors.error }]}>LOG OUT</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

export default ProfileScreen;
