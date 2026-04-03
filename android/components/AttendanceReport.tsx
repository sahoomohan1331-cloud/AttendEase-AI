import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, ActivityIndicator, Alert, ScrollView, Share
} from 'react-native';
import { collection, getDocs, addDoc } from 'firebase/firestore';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { db } from '../firebaseConfig';
import { colors, globalStyles } from '../styles';

interface AttendanceReportProps {
  onBack: () => void;
}

interface AttendanceRecord {
  id: string;
  subjectCode: string;
  subjectName: string;
  date: string;
  time: string;
  presentStudents: string[];
  totalFaces: number;
}

interface SubjectSummary {
  code: string;
  name: string;
  totalSessions: number;
  studentPresence: Record<string, number>; // regNumber → count
  records: AttendanceRecord[];
}

interface StudentRow {
  regNumber: string;
  present: number;
  total: number;
  percentage: number;
}

const AttendanceReport: React.FC<AttendanceReportProps> = ({ onBack }) => {
  const [loading, setLoading] = useState(true);
  const [allRecords, setAllRecords] = useState<AttendanceRecord[]>([]);
  const [subjects, setSubjects] = useState<SubjectSummary[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<SubjectSummary | null>(null);
  const [enrolledStudents, setEnrolledStudents] = useState<string[]>([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch attendance records
      const recSnap = await getDocs(collection(db, 'attendance_records'));
      const records: AttendanceRecord[] = [];
      recSnap.forEach((docSnap) => {
        const d = docSnap.data();
        records.push({
          id: docSnap.id,
          subjectCode: d.subjectCode || '',
          subjectName: d.subjectName || '',
          date: d.date || '',
          time: d.time || '',
          presentStudents: d.presentStudents || [],
          totalFaces: d.totalFaces || 0,
        });
      });
      setAllRecords(records);

      // Fetch enrolled students
      const studSnap = await getDocs(collection(db, 'Students'));
      const ids: string[] = [];
      studSnap.forEach((docSnap) => ids.push(docSnap.id));
      setEnrolledStudents(ids);

      // Group by subject
      const subjectMap: Record<string, SubjectSummary> = {};
      records.forEach((rec) => {
        if (!subjectMap[rec.subjectCode]) {
          subjectMap[rec.subjectCode] = {
            code: rec.subjectCode,
            name: rec.subjectName,
            totalSessions: 0,
            studentPresence: {},
            records: [],
          };
        }
        const sub = subjectMap[rec.subjectCode];
        sub.totalSessions++;
        sub.records.push(rec);
        rec.presentStudents.forEach((sid) => {
          sub.studentPresence[sid] = (sub.studentPresence[sid] || 0) + 1;
        });
      });

      setSubjects(Object.values(subjectMap).sort((a, b) => b.totalSessions - a.totalSessions));
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to load attendance data.');
    } finally {
      setLoading(false);
    }
  };

  // Build student-level data for the selected subject
  const getStudentRows = (): StudentRow[] => {
    if (!selectedSubject) return [];
    
    const allStudentIds = new Set<string>([
      ...enrolledStudents,
      ...Object.keys(selectedSubject.studentPresence),
    ]);

    const rows: StudentRow[] = [];
    allStudentIds.forEach((regNum) => {
      const present = selectedSubject.studentPresence[regNum] || 0;
      const total = selectedSubject.totalSessions;
      rows.push({
        regNumber: regNum,
        present,
        total,
        percentage: total > 0 ? Math.round((present / total) * 100) : 0,
      });
    });

    // Sort: highest attendance first, then by reg number
    return rows.sort((a, b) => b.percentage - a.percentage || a.regNumber.localeCompare(b.regNumber));
  };

  const getColor = (pct: number) => {
    if (pct >= 75) return colors.success;
    if (pct >= 50) return '#FFB800';
    return colors.error;
  };

  // Send warning notification to students with low attendance
  const nudgeStudent = async (student: StudentRow) => {
    if (!selectedSubject) return;
    try {
      await addDoc(collection(db, 'notifications'), {
        to: student.regNumber,
        type: 'warning',
        title: '⚠️ Low Attendance Warning',
        message: `Your attendance in ${selectedSubject.code} is currently ${student.percentage}%. Please ensure it stays above 75%.`,
        timestamp: new Date().toISOString(),
        read: false,
        subject: selectedSubject.code
      });
      Alert.alert('✅ Nudge Sent', `A warning has been sent to ${student.regNumber}.`);
    } catch (err) {
      Alert.alert('Error', 'Could not send notification.');
    }
  };

  // Export report as CSV file
  const exportToCSV = async () => {
    if (!selectedSubject) return;
    const rows = getStudentRows();
    
    let csv = `Registration Number,Present,Total Sessions,Percentage\n`;
    rows.forEach(r => {
      csv += `${r.regNumber},${r.present},${r.total},${r.percentage}%\n`;
    });

    const filename = `${selectedSubject.code}_Attendance_${new Date().toISOString().split('T')[0]}.csv`;
    const fileUri = (FileSystem as any).documentDirectory + filename;

    try {
      await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: (FileSystem as any).EncodingType.UTF8 });
      await Sharing.shareAsync(fileUri);
    } catch (err) {
      Alert.alert('Error', 'Could not generate CSV file.');
    }
  };

  // Standard share as text (fallback)
  const exportReport = async () => {
    if (!selectedSubject) return;
    const rows = getStudentRows();

    let report = `📋 ATTENDANCE REPORT\n`;
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `Subject: ${selectedSubject.code} — ${selectedSubject.name}\n`;
    report += `Total Sessions: ${selectedSubject.totalSessions}\n`;
    report += `Generated: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN')}\n`;
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    report += `Reg No.         Present  %\n`;
    report += `─────────────────────────\n`;

    rows.forEach((r) => {
      const status = r.percentage >= 75 ? '✅' : r.percentage >= 50 ? '⚠️' : '❌';
      report += `${r.regNumber.padEnd(16)} ${String(r.present).padStart(3)}/${r.total}   ${String(r.percentage).padStart(3)}% ${status}\n`;
    });

    report += `\n─────────────────────────\n`;
    const lowCount = rows.filter(r => r.percentage < 75).length;
    report += `⚠ Students below 75%: ${lowCount}/${rows.length}\n`;
    report += `\n— Generated by AttendEase AI`;

    try {
      await Share.share({
        title: `Attendance Report — ${selectedSubject.code}`,
        message: report,
      });
    } catch (err) {
      Alert.alert('Error', 'Could not share the report.');
    }
  };

  // ============================================================

  if (loading) {
    return (
      <View style={[globalStyles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.textMuted, marginTop: 16 }}>Loading attendance data...</Text>
      </View>
    );
  }

  // ---- SUBJECT DETAIL VIEW ----
  if (selectedSubject) {
    const rows = getStudentRows();
    const avgAttendance = rows.length > 0
      ? Math.round(rows.reduce((s, r) => s + r.percentage, 0) / rows.length)
      : 0;
    const lowCount = rows.filter(r => r.percentage < 75).length;

    return (
      <View style={globalStyles.container}>
        <View style={{ padding: 20 }}>
          <TouchableOpacity onPress={() => setSelectedSubject(null)}>
            <Text style={{ color: colors.primary, fontSize: 16 }}>← All Subjects</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text, marginTop: 8 }}>
            {selectedSubject.code}
          </Text>
          <Text style={{ color: colors.textMuted, marginTop: 4 }}>{selectedSubject.name}</Text>
        </View>

        {/* Summary Stats */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 20, marginBottom: 12 }}>
          <View style={[globalStyles.card, { flex: 1, marginRight: 6, padding: 16, alignItems: 'center' }]}>
            <Text style={{ color: colors.primary, fontSize: 28, fontWeight: '900' }}>
              {selectedSubject.totalSessions}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 4 }}>SESSIONS</Text>
          </View>
          <View style={[globalStyles.card, { flex: 1, marginHorizontal: 6, padding: 16, alignItems: 'center' }]}>
            <Text style={{ color: getColor(avgAttendance), fontSize: 28, fontWeight: '900' }}>
              {avgAttendance}%
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 4 }}>AVG ATT.</Text>
          </View>
          <View style={[globalStyles.card, { flex: 1, marginLeft: 6, padding: 16, alignItems: 'center' }]}>
            <Text style={{ color: lowCount > 0 ? colors.error : colors.success, fontSize: 28, fontWeight: '900' }}>
              {lowCount}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 4 }}>LOW ATT.</Text>
          </View>
        </View>

        {/* Table Header */}
        <View style={{
          flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 10,
          borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)',
        }}>
          <Text style={{ flex: 2, color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>
            REG. NUMBER
          </Text>
          <Text style={{ flex: 1, color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textAlign: 'center' }}>
            PRESENT
          </Text>
          <Text style={{ flex: 1, color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textAlign: 'right' }}>
            %
          </Text>
        </View>

        {/* Student Rows */}
        <FlatList
          data={rows}
          keyExtractor={(item) => item.regNumber}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
          renderItem={({ item }) => (
            <View style={{
              flexDirection: 'row', alignItems: 'center',
              paddingVertical: 12,
              borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)',
            }}>
              <Text style={{ flex: 2, color: colors.text, fontSize: 14, fontWeight: '600' }}>
                {item.regNumber}
              </Text>
              <Text style={{ flex: 1, color: colors.textMuted, fontSize: 14, textAlign: 'center' }}>
                {item.present}/{item.total}
              </Text>
              <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}>
                {item.percentage < 75 && (
                  <TouchableOpacity 
                    onPress={() => nudgeStudent(item)}
                    style={{ marginRight: 12, backgroundColor: 'rgba(255, 0, 85, 0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}
                  >
                    <Text style={{ color: colors.secondary, fontSize: 10, fontWeight: '700' }}>NUDGE</Text>
                  </TouchableOpacity>
                )}
                <View style={{
                  backgroundColor: `${getColor(item.percentage)}20`,
                  paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
                }}>
                  <Text style={{ color: getColor(item.percentage), fontSize: 13, fontWeight: '800' }}>
                    {item.percentage}%
                  </Text>
                </View>
                {item.percentage < 75 && (
                  <Text style={{ marginLeft: 4, fontSize: 10 }}>⚠️</Text>
                )}
              </View>
            </View>
          )}
          ListEmptyComponent={() => (
            <View style={{ alignItems: 'center', padding: 40 }}>
              <Text style={{ fontSize: 48, marginBottom: 16 }}>📭</Text>
              <Text style={{ color: colors.textMuted, textAlign: 'center' }}>
                No students found for this subject.
              </Text>
            </View>
          )}
        />

        {/* Export Buttons */}
        <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
          <Text style={{ color: colors.textMuted, fontSize: 10, marginBottom: 8, textAlign: 'center' }}>
            EXPORT & SHARE OPTIONS
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity style={[globalStyles.button, { flex: 1, backgroundColor: colors.success }]} onPress={exportToCSV}>
              <Text style={[globalStyles.buttonText, { color: '#000', fontSize: 14 }]}>📊 EXCEL/CSV</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[globalStyles.button, { flex: 1, backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary }]} onPress={exportReport}>
              <Text style={[globalStyles.buttonText, { color: colors.primary, fontSize: 14 }]}>📤 TEXT</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // ---- SUBJECT LIST VIEW ----
  return (
    <View style={globalStyles.container}>
      <View style={{ padding: 20 }}>
        <TouchableOpacity onPress={onBack}>
          <Text style={{ color: colors.primary, fontSize: 16 }}>← Back to Home</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 26, fontWeight: '800', color: colors.text, marginTop: 8 }}>
          📊 Attendance Report
        </Text>
        <Text style={{ color: colors.textMuted, marginTop: 4 }}>
          Select a subject to view detailed report
        </Text>
      </View>

      {/* Overall Stats Card */}
      <View style={[globalStyles.card, { marginHorizontal: 20, marginBottom: 16, padding: 20 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.primary, fontSize: 28, fontWeight: '900' }}>
              {allRecords.length}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 4 }}>TOTAL SESSIONS</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.success, fontSize: 28, fontWeight: '900' }}>
              {subjects.length}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 4 }}>SUBJECTS</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.secondary, fontSize: 28, fontWeight: '900' }}>
              {enrolledStudents.length}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 4 }}>STUDENTS</Text>
          </View>
        </View>
      </View>

      {subjects.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>📭</Text>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' }}>
            No Attendance Data
          </Text>
          <Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 8 }}>
            Take attendance first to generate reports.
          </Text>
        </View>
      ) : (
        <FlatList
          data={subjects}
          keyExtractor={(item) => item.code}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30 }}
          renderItem={({ item }) => {
            const uniqueStudents = Object.keys(item.studentPresence).length;
            const avgAtt = uniqueStudents > 0
              ? Math.round(
                  Object.values(item.studentPresence).reduce((s, c) => s + c, 0) /
                  (uniqueStudents * item.totalSessions) * 100
                )
              : 0;

            return (
              <TouchableOpacity
                style={[globalStyles.card, { marginBottom: 10, padding: 16 }]}
                onPress={() => setSelectedSubject(item)}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>
                      {item.code}
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 2 }}>
                      {item.name}
                    </Text>
                    <View style={{ flexDirection: 'row', marginTop: 8 }}>
                      <View style={{
                        backgroundColor: 'rgba(0,209,255,0.1)',
                        paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginRight: 8,
                      }}>
                        <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '600' }}>
                          {item.totalSessions} sessions
                        </Text>
                      </View>
                      <View style={{
                        backgroundColor: 'rgba(0,224,150,0.1)',
                        paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
                      }}>
                        <Text style={{ color: colors.success, fontSize: 11, fontWeight: '600' }}>
                          {uniqueStudents} students
                        </Text>
                      </View>
                    </View>
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ color: getColor(avgAtt), fontSize: 24, fontWeight: '900' }}>
                      {avgAtt}%
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: 9 }}>AVG</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Refresh */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
        <TouchableOpacity style={globalStyles.button} onPress={fetchData}>
          <Text style={globalStyles.buttonText}>↻ REFRESH</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default AttendanceReport;
