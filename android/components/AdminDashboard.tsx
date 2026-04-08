import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, ActivityIndicator, Alert, ScrollView, RefreshControl
} from 'react-native';
import {
  collection, getDocs, doc, updateDoc, deleteDoc, addDoc
} from 'firebase/firestore';
import axios from 'axios';
import { db } from '../firebaseConfig';
import { ENDPOINTS } from '../config';
import { colors, globalStyles } from '../styles';

interface AdminDashboardProps {
  onBack: () => void;
}

interface UserRecord {
  id: string;
  fullName: string;
  email: string;
  role: string;
  regNumber: string;
  department: string;
  batchYear: string;
  faceRegistered: boolean;
  approved: boolean;
  createdAt: string;
}

type Tab = 'pending' | 'approved' | 'analytics';

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<Tab>('pending');
  const [allUsers, setAllUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Analytics
  const [totalAttendanceSessions, setTotalAttendanceSessions] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [networkError, setNetworkError] = useState(false);

  useEffect(() => {
    fetchAllUsers();
    fetchAnalytics();
  }, []);

  const fetchAllUsers = async () => {
    setLoading(true);
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      const users: UserRecord[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        users.push({
          id: docSnap.id,
          fullName: data.fullName || 'Unknown',
          email: data.email || '',
          role: data.role || 'student',
          regNumber: data.regNumber || '',
          department: data.department || '',
          batchYear: data.batchYear || '',
          faceRegistered: data.faceRegistered || false,
          approved: data.approved || false,
          createdAt: data.createdAt || '',
        });
      });
      setAllUsers(users);
      setNetworkError(false);
    } catch (error) {
      console.error(error);
      setNetworkError(true);
      Alert.alert('Error', 'Failed to fetch users.');
    } finally {
      setLoading(false);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'attendance_records'));
      setTotalAttendanceSessions(snapshot.size);
    } catch (err) {
      console.error(err);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchAllUsers(), fetchAnalytics()]);
    setRefreshing(false);
  }, []);

  const pendingUsers = allUsers.filter((u) => !u.approved && u.role !== 'super-admin');
  const approvedUsers = allUsers.filter((u) => u.approved || u.role === 'super-admin');
  const studentCount = allUsers.filter((u) => u.role === 'student').length;
  const teacherCount = allUsers.filter((u) => u.role === 'teacher' || u.role === 'super-admin').length;
  const deptBreakdown: Record<string, number> = {};
  allUsers.filter(u => u.role === 'student').forEach((u) => {
    if (u.department) {
      deptBreakdown[u.department] = (deptBreakdown[u.department] || 0) + 1;
    }
  });

  // ---- Actions ----

  const logAction = async (action: string, targetUser: string) => {
    try {
      await addDoc(collection(db, 'audit_log'), {
        action,
        targetUser,
        timestamp: new Date().toISOString(),
        performedBy: 'super-admin',
      });
    } catch (err) {
      console.warn('Audit log failed:', err);
    }
  };

  const approveUser = async (userId: string, userName: string) => {
    Alert.alert('Approve User', `Approve ${userName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Approve',
        onPress: async () => {
          setActionLoading(userId);
          try {
            await updateDoc(doc(db, 'users', userId), { approved: true });
            await logAction('APPROVED', userName);
            setAllUsers((prev) => prev.map((u) =>
              u.id === userId ? { ...u, approved: true } : u
            ));
            Alert.alert('✅ Approved', `${userName} now has access.`);
          } catch (error) {
            Alert.alert('Error', 'Failed to approve user.');
          } finally {
            setActionLoading(null);
          }
        },
      },
    ]);
  };

  const rejectUser = async (userId: string, userName: string) => {
    Alert.alert(
      '⚠️ Reject & Delete',
      `Permanently remove ${userName}? They can re-register.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            setActionLoading(userId);
            try {
              await deleteDoc(doc(db, 'users', userId));
              try {
                const formData = new FormData();
                formData.append('uid', userId);
                await axios.post(ENDPOINTS.DELETE_USER, formData, {
                  headers: { 
                    'Content-Type': 'multipart/form-data',
                    'X-Admin-Token': 'attendease-admin-2026',
                  },
                  timeout: 10000,
                });
              } catch (backendErr) {
                console.warn('Backend auth deletion failed:', backendErr);
              }
              await logAction('REJECTED', userName);
              setAllUsers((prev) => prev.filter((u) => u.id !== userId));
              Alert.alert('Removed', `${userName} has been fully deleted.`);
            } catch (error) {
              Alert.alert('Error', 'Failed to delete user.');
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  };

  const revokeAccess = async (userId: string, userName: string) => {
    Alert.alert(
      'Revoke Access',
      `Remove ${userName}'s access? Their data will be kept but they won't be able to use the app.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke', style: 'destructive',
          onPress: async () => {
            setActionLoading(userId);
            try {
              await updateDoc(doc(db, 'users', userId), { approved: false });
              await logAction('REVOKED', userName);
              setAllUsers((prev) => prev.map((u) =>
                u.id === userId ? { ...u, approved: false } : u
              ));
              Alert.alert('Access Revoked', `${userName} can no longer use the app.`);
            } catch (error) {
              Alert.alert('Error', 'Failed to revoke access.');
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  };

  const bulkApprove = () => {
    if (pendingUsers.length === 0) {
      return Alert.alert('No Pending', 'There are no pending users to approve.');
    }
    Alert.alert(
      'Bulk Approve',
      `Approve all ${pendingUsers.length} pending users at once?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Approve All (${pendingUsers.length})`,
          onPress: async () => {
            setActionLoading('bulk');
            try {
              const promises = pendingUsers.map((u) =>
                updateDoc(doc(db, 'users', u.id), { approved: true })
              );
              await Promise.all(promises);
              await logAction('BULK_APPROVED', `${pendingUsers.length} users`);
              setAllUsers((prev) => prev.map((u) => ({ ...u, approved: true })));
              Alert.alert('✅ Done', `All ${pendingUsers.length} users have been approved!`);
            } catch (err) {
              Alert.alert('Error', 'Bulk approval failed.');
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  };

  // ---- Render Helpers ----

  const renderUserCard = (item: UserRecord, showApproveReject: boolean) => {
    const isProcessing = actionLoading === item.id;
    return (
      <View style={[globalStyles.card, { marginBottom: 10 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', flex: 1 }}>
            {item.fullName}
          </Text>
          <View style={{
            backgroundColor: item.role === 'teacher' ? 'rgba(255,0,85,0.15)' : item.role === 'super-admin' ? 'rgba(255,0,85,0.25)' : 'rgba(0,209,255,0.15)',
            paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
          }}>
            <Text style={{
              color: item.role === 'teacher' || item.role === 'super-admin' ? colors.secondary : colors.primary,
              fontSize: 10, fontWeight: '700', letterSpacing: 1,
            }}>{item.role.toUpperCase()}</Text>
          </View>
        </View>

        {[
          { label: 'Email', value: item.email },
          { label: 'Reg No.', value: item.regNumber || '—' },
          { label: 'Dept', value: item.department || '—' },
          { label: 'Face ID', value: item.faceRegistered ? '✅' : (item.role === 'teacher' ? '—' : '⚠️') },
        ].map((row) => (
          <View key={row.label} style={{
            flexDirection: 'row', justifyContent: 'space-between',
            paddingVertical: 4,
          }}>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>{row.label}</Text>
            <Text style={{ color: colors.text, fontSize: 12, fontWeight: '500' }}>{row.value}</Text>
          </View>
        ))}

        {isProcessing ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />
        ) : showApproveReject ? (
          <View style={{ flexDirection: 'row', marginTop: 12 }}>
            <TouchableOpacity
              style={[globalStyles.button, { flex: 1, marginRight: 6, height: 40 }]}
              onPress={() => approveUser(item.id, item.fullName)}
            >
              <Text style={[globalStyles.buttonText, { fontSize: 13 }]}>✓ APPROVE</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[globalStyles.button, {
                flex: 1, marginLeft: 6, height: 40,
                backgroundColor: 'rgba(255,61,113,0.12)',
                borderWidth: 1, borderColor: colors.error,
              }]}
              onPress={() => rejectUser(item.id, item.fullName)}
            >
              <Text style={[globalStyles.buttonText, { fontSize: 13, color: colors.error }]}>✗ REJECT</Text>
            </TouchableOpacity>
          </View>
        ) : item.role !== 'super-admin' ? (
          <TouchableOpacity
            style={[globalStyles.button, {
              marginTop: 12, height: 40,
              backgroundColor: 'transparent',
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
            }]}
            onPress={() => revokeAccess(item.id, item.fullName)}
          >
            <Text style={[globalStyles.buttonText, { fontSize: 13, color: colors.textMuted }]}>
              REVOKE ACCESS
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  // ---- TAB BAR ----

  const TabButton = ({ tab, label, count }: { tab: Tab; label: string; count?: number }) => (
    <TouchableOpacity
      style={{
        flex: 1, paddingVertical: 10, borderRadius: 10,
        backgroundColor: activeTab === tab ? colors.primary : 'transparent',
        alignItems: 'center',
      }}
      onPress={() => setActiveTab(tab)}
    >
      <Text style={{
        color: activeTab === tab ? '#000' : colors.textMuted,
        fontWeight: '700', fontSize: 12,
      }}>
        {label} {count !== undefined ? `(${count})` : ''}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={globalStyles.container}>
      {/* Header */}
      <View style={{ padding: 20, paddingBottom: 12 }}>
        <TouchableOpacity onPress={onBack}>
          <Text style={{ color: colors.primary, fontSize: 16 }}>← Back</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 26, fontWeight: '800', color: colors.text, marginTop: 8 }}>
          Admin Panel
        </Text>
      </View>

      {/* Network Error Banner */}
      {networkError && (
        <View style={{ marginHorizontal: 20, backgroundColor: 'rgba(255,61,113,0.1)', padding: 12, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,61,113,0.3)' }}>
          <Text style={{ color: colors.error, fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
            ⚠️ Connection error. Swipe down to retry.
          </Text>
        </View>
      )}

      {/* Tab Bar */}
      <View style={{
        flexDirection: 'row', marginHorizontal: 20, marginBottom: 16,
        backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 4,
      }}>
        <TabButton tab="pending" label="Pending" count={pendingUsers.length} />
        <TabButton tab="approved" label="Approved" count={approvedUsers.length} />
        <TabButton tab="analytics" label="Analytics" />
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <>
          {/* ============ PENDING TAB ============ */}
          {activeTab === 'pending' && (
            <>
              {pendingUsers.length > 1 && (
                <TouchableOpacity
                  style={[globalStyles.button, {
                    marginHorizontal: 20, marginBottom: 12, height: 44,
                    backgroundColor: colors.success,
                  }]}
                  onPress={bulkApprove}
                  disabled={actionLoading === 'bulk'}
                >
                  {actionLoading === 'bulk' ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <Text style={[globalStyles.buttonText, { color: '#000' }]}>
                      ✓ APPROVE ALL ({pendingUsers.length})
                    </Text>
                  )}
                </TouchableOpacity>
              )}
              {pendingUsers.length === 0 ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
                  <Text style={{ fontSize: 48, marginBottom: 16 }}>✅</Text>
                  <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>All Clear!</Text>
                  <Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 8 }}>
                    No pending registrations.
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={pendingUsers}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => renderUserCard(item, true)}
                  contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
                  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
                />
              )}
            </>
          )}

          {/* ============ APPROVED TAB ============ */}
          {activeTab === 'approved' && (
            <FlatList
              data={approvedUsers}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => renderUserCard(item, false)}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
              ListEmptyComponent={() => (
                <View style={{ alignItems: 'center', padding: 40 }}>
                  <Text style={{ color: colors.textMuted }}>No approved users yet.</Text>
                </View>
              )}
            />
          )}

          {/* ============ ANALYTICS TAB ============ */}
          {activeTab === 'analytics' && (
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30 }}>
              {/* Overview Stats */}
              <View style={{ flexDirection: 'row', marginBottom: 12 }}>
                <View style={[globalStyles.card, { flex: 1, marginRight: 6, alignItems: 'center', padding: 20 }]}>
                  <Text style={{ color: colors.primary, fontSize: 32, fontWeight: '900' }}>
                    {allUsers.length}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>TOTAL USERS</Text>
                </View>
                <View style={[globalStyles.card, { flex: 1, marginLeft: 6, alignItems: 'center', padding: 20 }]}>
                  <Text style={{ color: colors.success, fontSize: 32, fontWeight: '900' }}>
                    {totalAttendanceSessions}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>SESSIONS</Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', marginBottom: 16 }}>
                <View style={[globalStyles.card, { flex: 1, marginRight: 6, alignItems: 'center', padding: 16 }]}>
                  <Text style={{ color: colors.primary, fontSize: 24, fontWeight: '800' }}>{studentCount}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>STUDENTS</Text>
                </View>
                <View style={[globalStyles.card, { flex: 1, marginHorizontal: 6, alignItems: 'center', padding: 16 }]}>
                  <Text style={{ color: colors.secondary, fontSize: 24, fontWeight: '800' }}>{teacherCount}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>TEACHERS</Text>
                </View>
                <View style={[globalStyles.card, { flex: 1, marginLeft: 6, alignItems: 'center', padding: 16 }]}>
                  <Text style={{ color: '#FFB800', fontSize: 24, fontWeight: '800' }}>{pendingUsers.length}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>PENDING</Text>
                </View>
              </View>

              {/* Department Breakdown */}
              <View style={globalStyles.card}>
                <Text style={{ color: colors.textMuted, fontSize: 12, letterSpacing: 1, marginBottom: 16 }}>
                  STUDENTS BY DEPARTMENT
                </Text>
                {Object.keys(deptBreakdown).length === 0 ? (
                  <Text style={{ color: colors.textMuted, textAlign: 'center', paddingVertical: 20 }}>
                    No students registered yet.
                  </Text>
                ) : (
                  Object.entries(deptBreakdown)
                    .sort((a, b) => b[1] - a[1])
                    .map(([dept, count]) => {
                      const maxCount = Math.max(...Object.values(deptBreakdown));
                      const barWidth = maxCount > 0 ? (count / maxCount) * 100 : 0;
                      return (
                        <View key={dept} style={{ marginBottom: 12 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>{dept}</Text>
                            <Text style={{ color: colors.textMuted, fontSize: 14 }}>{count}</Text>
                          </View>
                          <View style={{
                            height: 8, borderRadius: 4,
                            backgroundColor: 'rgba(255,255,255,0.06)',
                            overflow: 'hidden',
                          }}>
                            <View style={{
                              height: '100%', borderRadius: 4,
                              backgroundColor: colors.primary,
                              width: `${barWidth}%`,
                            }} />
                          </View>
                        </View>
                      );
                    })
                )}
              </View>

              {/* Refresh */}
              <TouchableOpacity
                style={[globalStyles.button, { marginTop: 16 }]}
                onPress={() => { fetchAllUsers(); fetchAnalytics(); }}
              >
                <Text style={globalStyles.buttonText}>↻ REFRESH DATA</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
};

export default AdminDashboard;
