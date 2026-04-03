import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { collection, query, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { signOut } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import { colors, globalStyles } from '../styles';
import { Screen } from '../App';

interface HomeScreenProps {
  onNavigate: (screen: Screen) => void;
  userRole: 'teacher' | 'student' | 'super-admin' | null;
  regNumber: string;
}

const HomeScreen: React.FC<HomeScreenProps> = ({ onNavigate, userRole, regNumber }) => {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const isAdmin = userRole === 'teacher' || userRole === 'super-admin';

  useEffect(() => {
    if (userRole === 'student') {
      fetchNotifications();
    }
  }, [userRole]);

  const fetchNotifications = async () => {
    setNotifLoading(true);
    try {
      // Temporarily avoiding composite index by sorting locally
      const q = query(
        collection(db, 'notifications'), 
        where('to', '==', regNumber),
        limit(20) // Fetch a few more to sort locally
      );
      const snapshot = await getDocs(q);
      const list: any[] = [];
      snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
      
      // Sort locally: newest first
      const sorted = list.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      
      setNotifications(sorted.slice(0, 5));
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setNotifLoading(false);
    }
  };

  const ActionCard = ({
    emoji, title, subtitle, onPress, accentColor
  }: {
    emoji: string; title: string; subtitle: string;
    onPress: () => void; accentColor?: string;
  }) => (
    <TouchableOpacity
      style={[globalStyles.card, {
        marginBottom: 12, padding: 18,
        flexDirection: 'row', alignItems: 'center',
        borderColor: accentColor ? `${accentColor}33` : 'rgba(255,255,255,0.05)',
        borderWidth: 1,
      }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={{
        width: 48, height: 48, borderRadius: 14,
        backgroundColor: accentColor ? `${accentColor}15` : 'rgba(255,255,255,0.06)',
        justifyContent: 'center', alignItems: 'center',
        marginRight: 14,
      }}>
        <Text style={{ fontSize: 22 }}>{emoji}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{title}</Text>
        <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>{subtitle}</Text>
      </View>
      <Text style={{ color: colors.textMuted, fontSize: 16 }}>›</Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      {/* Header */}
      <View style={{ marginTop: 30, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 32, fontWeight: '900', color: colors.primary, letterSpacing: 1 }}>
            ATTENDEASE
          </Text>
          <View style={{
            alignSelf: 'flex-start', marginTop: 6,
            backgroundColor: userRole === 'super-admin'
              ? 'rgba(255, 0, 85, 0.15)'
              : userRole === 'teacher'
                ? 'rgba(0, 209, 255, 0.15)'
                : 'rgba(0, 224, 150, 0.15)',
            paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
          }}>
            <Text style={{
              fontSize: 11, fontWeight: '700', letterSpacing: 1,
              color: userRole === 'super-admin'
                ? colors.secondary
                : userRole === 'teacher'
                  ? colors.primary
                  : colors.success,
            }}>
              {userRole === 'super-admin' ? 'SUPER ADMIN' : userRole?.toUpperCase() || '...'}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={{
            backgroundColor: 'rgba(255,255,255,0.05)',
            padding: 12, borderRadius: 12,
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
          }}
          onPress={() => onNavigate('profile')}
        >
          <Text style={{ fontSize: 20 }}>👤</Text>
        </TouchableOpacity>
      </View>

      {/* Welcome Card */}
      <View style={[globalStyles.card, { marginTop: 24 }]}>
        <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800' }}>
          {isAdmin ? 'Welcome, Admin 👋' : 'Welcome 👋'}
        </Text>
        <Text style={{ color: colors.textMuted, marginTop: 6, fontSize: 14, lineHeight: 20 }}>
          {isAdmin
            ? 'Manage enrollments, scan classrooms, and review registrations.'
            : 'Track your attendance and stay updated.'}
        </Text>
      </View>

      {/* Quick Actions */}
      <View style={{ marginTop: 20 }}>
        <Text style={{ color: colors.textMuted, fontSize: 12, letterSpacing: 1, marginBottom: 12, marginLeft: 4 }}>
          QUICK ACTIONS
        </Text>

        {/* Super-Admin: Admin Panel */}
        {userRole === 'super-admin' && (
          <ActionCard
            emoji="👑"
            title="Admin Panel"
            subtitle="Approve or reject pending registrations"
            onPress={() => onNavigate('admin')}
            accentColor={colors.secondary}
          />
        )}

        {/* Teacher/Admin: Attendance */}
        {isAdmin && (
          <>
            <ActionCard
              emoji="📸"
              title="Take Attendance"
              subtitle="AI-powered classroom scanning"
              onPress={() => onNavigate('attendance')}
              accentColor={colors.primary}
            />
            <ActionCard
              emoji="📊"
              title="Attendance Report"
              subtitle="View per-subject reports and share them"
              onPress={() => onNavigate('report')}
              accentColor="#FFB800"
            />
            <ActionCard
              emoji="👤"
              title="Enroll Student"
              subtitle="Register a new student with Face ID"
              onPress={() => onNavigate('register')}
              accentColor={colors.success}
            />
          </>
        )}

        {/* Student: Attendance History */}
        {userRole === 'student' && (
          <ActionCard
            emoji="📊"
            title="My Attendance"
            subtitle="View your attendance percentage and history"
            onPress={() => onNavigate('history')}
            accentColor={colors.primary}
          />
        )}

        {/* Everyone: Profile */}
        <ActionCard
          emoji="⚙️"
          title="My Profile"
          subtitle="View account details and settings"
          onPress={() => onNavigate('profile')}
        />

        {/* Student Notifications Section */}
        {userRole === 'student' && (
          <View style={{ marginTop: 24 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ color: colors.textMuted, fontSize: 12, letterSpacing: 1, marginLeft: 4 }}>
                RECENT NOTIFICATIONS
              </Text>
              <TouchableOpacity onPress={fetchNotifications}>
                <Text style={{ color: colors.primary, fontSize: 11 }}>REFRESH</Text>
              </TouchableOpacity>
            </View>

            {notifLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : notifications.length > 0 ? (
              notifications.map((notif) => (
                <View key={notif.id} style={[globalStyles.card, { 
                  padding: 14, marginBottom: 10,
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  borderColor: 'rgba(255,255,255,0.05)', borderWidth: 1
                }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ 
                      width: 32, height: 32, borderRadius: 10, 
                      backgroundColor: 'rgba(0, 224, 150, 0.1)', 
                      justifyContent: 'center', alignItems: 'center',
                      marginRight: 12
                    }}>
                      <Text style={{ fontSize: 14 }}>✅</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{notif.title}</Text>
                      <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>{notif.message}</Text>
                      <Text style={{ color: colors.textMuted, fontSize: 9, marginTop: 4, opacity: 0.7 }}>
                        {new Date(notif.timestamp).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                      </Text>
                    </View>
                  </View>
                </View>
              ))
            ) : (
              <View style={[globalStyles.card, { padding: 20, alignItems: 'center' }]}>
                <Text style={{ color: colors.textMuted, fontSize: 13 }}>No new notifications</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Footer */}
      <View style={{ marginTop: 30, alignItems: 'center', opacity: 0.4 }}>
        <Text style={{ color: colors.textMuted, fontSize: 11 }}>
          AttendEase AI v3.0
        </Text>
      </View>
    </ScrollView>
  );
};

export default HomeScreen;
