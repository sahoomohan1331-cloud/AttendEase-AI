import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, ActivityIndicator, Alert, ScrollView
} from 'react-native';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { colors, globalStyles } from '../styles';

interface AttendanceHistoryProps {
  onBack: () => void;
  userRegNumber: string;
}

interface AttendanceRecord {
  id: string;
  subjectCode: string;
  subjectName: string;
  date: string;
  time: string;
}

const AttendanceHistory: React.FC<AttendanceHistoryProps> = ({ onBack, userRegNumber }) => {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalClasses, setTotalClasses] = useState(0);
  const [presentCount, setPresentCount] = useState(0);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      // Get all attendance records
      const snapshot = await getDocs(collection(db, 'attendance_records'));

      const allRecords: AttendanceRecord[] = [];
      let total = 0;
      let present = 0;

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        total++;
        const students: string[] = data.presentStudents || [];

        if (students.includes(userRegNumber)) {
          present++;
          allRecords.push({
            id: docSnap.id,
            subjectCode: data.subjectCode || '',
            subjectName: data.subjectName || '',
            date: data.date || '',
            time: data.time || '',
          });
        }
      });

      // Sort by date (newest first)
      allRecords.sort((a, b) => b.date.localeCompare(a.date));

      setRecords(allRecords);
      setTotalClasses(total);
      setPresentCount(present);
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to load attendance history.');
    } finally {
      setLoading(false);
    }
  };

  const percentage = totalClasses > 0 ? Math.round((presentCount / totalClasses) * 100) : 0;

  const getPercentageColor = () => {
    if (percentage >= 75) return colors.success;
    if (percentage >= 50) return '#FFB800';
    return colors.error;
  };

  return (
    <View style={globalStyles.container}>
      {/* Header */}
      <View style={{ padding: 20 }}>
        <TouchableOpacity onPress={onBack}>
          <Text style={{ color: colors.primary, fontSize: 16 }}>← Back to Dashboard</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 26, fontWeight: '800', color: colors.text, marginTop: 8 }}>
          My Attendance
        </Text>
        <Text style={{ color: colors.textMuted, marginTop: 4 }}>
          Reg. No: {userRegNumber}
        </Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ color: colors.textMuted, marginTop: 16 }}>Loading your records...</Text>
        </View>
      ) : (
        <>
          {/* Stats Cards */}
          <View style={{ flexDirection: 'row', paddingHorizontal: 20, marginBottom: 16 }}>
            {/* Percentage */}
            <View style={[globalStyles.card, {
              flex: 1, marginRight: 8, padding: 20, alignItems: 'center',
              borderColor: getPercentageColor(),
              borderWidth: 1,
            }]}>
              <Text style={{
                color: getPercentageColor(),
                fontSize: 36, fontWeight: '900',
              }}>
                {percentage}%
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>ATTENDANCE</Text>
              {percentage < 75 && (
                <View style={{
                  marginTop: 8, backgroundColor: 'rgba(255, 61, 113, 0.1)',
                  paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
                }}>
                  <Text style={{ color: colors.error, fontSize: 10, fontWeight: '700' }}>⚠ LOW</Text>
                </View>
              )}
            </View>

            {/* Counts */}
            <View style={[globalStyles.card, { flex: 1, marginLeft: 8, padding: 20, alignItems: 'center' }]}>
              <Text style={{ color: colors.primary, fontSize: 28, fontWeight: '800' }}>
                {presentCount}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>
                OUT OF {totalClasses}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 4 }}>CLASSES</Text>
            </View>
          </View>

          {/* Records List */}
          <View style={{ paddingHorizontal: 20, marginBottom: 8 }}>
            <Text style={{ color: colors.textMuted, fontSize: 12, letterSpacing: 1 }}>
              ATTENDANCE HISTORY
            </Text>
          </View>

          {records.length === 0 ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
              <Text style={{ fontSize: 48, marginBottom: 16 }}>📭</Text>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' }}>
                No Records Yet
              </Text>
              <Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 8 }}>
                Your attendance will appear here once a teacher scans the classroom.
              </Text>
            </View>
          ) : (
            <FlatList
              data={records}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
              renderItem={({ item }) => (
                <View style={[globalStyles.card, {
                  marginBottom: 8, padding: 14,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{
                      width: 40, height: 40, borderRadius: 12,
                      backgroundColor: 'rgba(0, 224, 150, 0.1)',
                      justifyContent: 'center', alignItems: 'center',
                      marginRight: 12,
                    }}>
                      <Text style={{ color: colors.success, fontWeight: 'bold', fontSize: 14 }}>✓</Text>
                    </View>
                    <View>
                      <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>
                        {item.subjectCode}
                      </Text>
                      <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                        {item.subjectName}
                      </Text>
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: colors.textMuted, fontSize: 12 }}>{item.date}</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>{item.time}</Text>
                  </View>
                </View>
              )}
            />
          )}

          {/* Refresh */}
          <TouchableOpacity
            style={[globalStyles.button, { marginHorizontal: 20, marginBottom: 20 }]}
            onPress={fetchHistory}
          >
            <Text style={globalStyles.buttonText}>↻ REFRESH</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
};

export default AttendanceHistory;
