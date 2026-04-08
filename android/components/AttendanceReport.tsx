import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, ActivityIndicator, Alert,
  ScrollView, Share, Image as RNImage, Modal, Dimensions
} from 'react-native';
import { collection, getDocs, addDoc } from 'firebase/firestore';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { db } from '../firebaseConfig';
import { colors, globalStyles } from '../styles';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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
  photoUrl?: string;
}

interface SubjectSummary {
  code: string;
  name: string;
  totalSessions: number;
  studentPresence: Record<string, number>;
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
  const [activeTab, setActiveTab] = useState<'students' | 'sessions'>('students');
  const [photoModalUrl, setPhotoModalUrl] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
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
          photoUrl: d.photoUrl || undefined,
        });
      });
      setAllRecords(records);

      const studSnap = await getDocs(collection(db, 'Students'));
      const ids: string[] = [];
      studSnap.forEach((docSnap) => ids.push(docSnap.id));
      setEnrolledStudents(ids);

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

    return rows.sort((a, b) => b.percentage - a.percentage || a.regNumber.localeCompare(b.regNumber));
  };

  const getColor = (pct: number) => {
    if (pct >= 75) return colors.success;
    if (pct >= 50) return '#FFB800';
    return colors.error;
  };

  const getStatusLabel = (pct: number) => {
    if (pct >= 75) return 'Good';
    if (pct >= 50) return 'At Risk';
    return 'Critical';
  };

  const getStatusIcon = (pct: number) => {
    if (pct >= 75) return '✅';
    if (pct >= 50) return '⚠️';
    return '🔴';
  };

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
        {/* Header */}
        <View style={{ padding: 20, paddingBottom: 12 }}>
          <TouchableOpacity onPress={() => { setSelectedSubject(null); setActiveTab('students'); }} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ color: colors.primary, fontSize: 15, fontWeight: '600' }}>← All Subjects</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 10, gap: 10 }}>
            <Text style={{ fontSize: 26, fontWeight: '900', color: colors.text }}>
              {selectedSubject.code}
            </Text>
            <View style={{ backgroundColor: 'rgba(0, 209, 255, 0.12)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 }}>
              <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>{selectedSubject.name}</Text>
            </View>
          </View>
        </View>

        {/* Summary Stats */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 20, marginBottom: 16, gap: 8 }}>
          <View style={{
            flex: 1, backgroundColor: 'rgba(0, 209, 255, 0.08)', borderRadius: 20, padding: 16, alignItems: 'center',
            borderWidth: 1, borderColor: 'rgba(0, 209, 255, 0.15)',
          }}>
            <Text style={{ color: colors.primary, fontSize: 30, fontWeight: '900' }}>
              {selectedSubject.totalSessions}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 4, letterSpacing: 1 }}>SESSIONS</Text>
          </View>
          <View style={{
            flex: 1, backgroundColor: `${getColor(avgAttendance)}10`, borderRadius: 20, padding: 16, alignItems: 'center',
            borderWidth: 1, borderColor: `${getColor(avgAttendance)}25`,
          }}>
            <Text style={{ color: getColor(avgAttendance), fontSize: 30, fontWeight: '900' }}>
              {avgAttendance}%
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 4, letterSpacing: 1 }}>AVG ATT.</Text>
          </View>
          <View style={{
            flex: 1, backgroundColor: lowCount > 0 ? 'rgba(255, 61, 113, 0.08)' : 'rgba(0, 224, 150, 0.08)', borderRadius: 20, padding: 16, alignItems: 'center',
            borderWidth: 1, borderColor: lowCount > 0 ? 'rgba(255, 61, 113, 0.15)' : 'rgba(0, 224, 150, 0.15)',
          }}>
            <Text style={{ color: lowCount > 0 ? colors.error : colors.success, fontSize: 30, fontWeight: '900' }}>
              {lowCount}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 4, letterSpacing: 1 }}>LOW ATT.</Text>
          </View>
        </View>

        {/* Tab Switcher */}
        <View style={{ flexDirection: 'row', marginHorizontal: 20, marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: 4 }}>
          <TouchableOpacity
            style={{
              flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center',
              backgroundColor: activeTab === 'students' ? colors.primary : 'transparent',
            }}
            onPress={() => setActiveTab('students')}
          >
            <Text style={{ color: activeTab === 'students' ? '#000' : colors.textMuted, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 }}>
              👥 Students
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{
              flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center',
              backgroundColor: activeTab === 'sessions' ? colors.primary : 'transparent',
            }}
            onPress={() => setActiveTab('sessions')}
          >
            <Text style={{ color: activeTab === 'sessions' ? '#000' : colors.textMuted, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 }}>
              📸 Sessions
            </Text>
          </TouchableOpacity>
        </View>

        {/* ---- STUDENTS TAB ---- */}
        {activeTab === 'students' && (
          <FlatList
            data={rows}
            keyExtractor={(item) => item.regNumber}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
            renderItem={({ item }) => (
              <View style={{
                backgroundColor: 'rgba(255,255,255,0.03)',
                borderRadius: 16, padding: 14, marginBottom: 8,
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
              }}>
                {/* Row 1: Reg Number + Status */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <Text style={{ fontSize: 14 }}>{getStatusIcon(item.percentage)} </Text>
                    <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>
                      {item.regNumber}
                    </Text>
                  </View>
                  <View style={{
                    backgroundColor: `${getColor(item.percentage)}18`,
                    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10,
                  }}>
                    <Text style={{ color: getColor(item.percentage), fontSize: 14, fontWeight: '800' }}>
                      {item.percentage}%
                    </Text>
                  </View>
                </View>

                {/* Row 2: Details + Nudge */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                    {item.present}/{item.total} sessions • {getStatusLabel(item.percentage)}
                  </Text>
                  {item.percentage < 75 && (
                    <TouchableOpacity
                      onPress={() => nudgeStudent(item)}
                      style={{
                        flexDirection: 'row', alignItems: 'center',
                        backgroundColor: 'rgba(255, 0, 85, 0.12)',
                        paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
                        borderWidth: 1, borderColor: 'rgba(255, 0, 85, 0.25)',
                      }}
                    >
                      <Text style={{ fontSize: 12, marginRight: 4 }}>🔔</Text>
                      <Text style={{ color: colors.secondary, fontSize: 11, fontWeight: '700' }}>Nudge</Text>
                    </TouchableOpacity>
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
        )}

        {/* ---- SESSIONS TAB (Photo Evidence) ---- */}
        {activeTab === 'sessions' && (
          <FlatList
            data={selectedSubject.records.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
            renderItem={({ item }) => (
              <View style={{
                backgroundColor: 'rgba(255,255,255,0.03)',
                borderRadius: 20, marginBottom: 12, overflow: 'hidden',
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
              }}>
                {/* Photo thumbnail */}
                {item.photoUrl ? (
                  <TouchableOpacity onPress={() => setPhotoModalUrl(item.photoUrl!)}>
                    <RNImage
                      source={{ uri: item.photoUrl }}
                      style={{ width: '100%', height: 180, backgroundColor: '#111' }}
                      resizeMode="cover"
                    />
                    <View style={{
                      position: 'absolute', bottom: 8, right: 8,
                      backgroundColor: 'rgba(0,0,0,0.7)',
                      paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
                    }}>
                      <Text style={{ color: colors.primary, fontSize: 10, fontWeight: '700' }}>🔍 Tap to zoom</Text>
                    </View>
                  </TouchableOpacity>
                ) : (
                  <View style={{ width: '100%', height: 100, backgroundColor: 'rgba(255,255,255,0.03)', justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ fontSize: 32 }}>📷</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>No photo captured</Text>
                  </View>
                )}

                {/* Session info */}
                <View style={{ padding: 14 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View>
                      <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>
                        {new Date(item.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </Text>
                      <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                        🕐 {item.time}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <View style={{
                        backgroundColor: 'rgba(0, 224, 150, 0.12)',
                        paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10,
                      }}>
                        <Text style={{ color: colors.success, fontSize: 14, fontWeight: '800' }}>
                          {item.presentStudents.length} present
                        </Text>
                      </View>
                      <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>
                        {item.totalFaces} faces detected
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            )}
            ListEmptyComponent={() => (
              <View style={{ alignItems: 'center', padding: 40 }}>
                <Text style={{ fontSize: 48, marginBottom: 16 }}>📚</Text>
                <Text style={{ color: colors.textMuted, textAlign: 'center' }}>
                  No sessions recorded yet.
                </Text>
              </View>
            )}
          />
        )}

        {/* Export Buttons */}
        <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
          <Text style={{ color: colors.textMuted, fontSize: 10, marginBottom: 8, textAlign: 'center', letterSpacing: 1 }}>
            EXPORT & SHARE
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity
              style={{
                flex: 1, backgroundColor: colors.success, borderRadius: 14, height: 50,
                justifyContent: 'center', alignItems: 'center',
                elevation: 4, shadowColor: colors.success, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6,
              }}
              onPress={exportToCSV}
            >
              <Text style={{ color: '#000', fontSize: 14, fontWeight: '800', letterSpacing: 0.5 }}>📊 Excel/CSV</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{
                flex: 1, backgroundColor: 'transparent', borderRadius: 14, height: 50,
                justifyContent: 'center', alignItems: 'center',
                borderWidth: 1.5, borderColor: colors.primary,
              }}
              onPress={exportReport}
            >
              <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '800', letterSpacing: 0.5 }}>📤 Text</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Photo Modal */}
        <Modal visible={!!photoModalUrl} transparent animationType="fade">
          <View style={{
            flex: 1, backgroundColor: 'rgba(0,0,0,0.95)',
            justifyContent: 'center', alignItems: 'center',
          }}>
            <TouchableOpacity
              style={{ position: 'absolute', top: 50, right: 20, zIndex: 10 }}
              onPress={() => setPhotoModalUrl(null)}
            >
              <View style={{
                backgroundColor: 'rgba(255,255,255,0.15)',
                padding: 12, borderRadius: 20,
              }}>
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}>✕</Text>
              </View>
            </TouchableOpacity>

            {photoModalUrl && (
              <RNImage
                source={{ uri: photoModalUrl }}
                style={{ width: SCREEN_WIDTH - 20, height: '80%' }}
                resizeMode="contain"
              />
            )}

            {/* Legend */}
            <View style={{
              position: 'absolute', bottom: 40,
              flexDirection: 'row', gap: 16,
            }}>
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: 'rgba(0,0,0,0.7)',
                paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
              }}>
                <View style={{ width: 14, height: 14, backgroundColor: '#00E096', borderRadius: 3, marginRight: 6 }} />
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Recognized</Text>
              </View>
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: 'rgba(0,0,0,0.7)',
                paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
              }}>
                <View style={{ width: 14, height: 14, backgroundColor: '#FF3C3C', borderRadius: 3, marginRight: 6 }} />
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Unknown</Text>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ---- SUBJECT LIST VIEW ----
  return (
    <View style={globalStyles.container}>
      <View style={{ padding: 20 }}>
        <TouchableOpacity onPress={onBack}>
          <Text style={{ color: colors.primary, fontSize: 15, fontWeight: '600' }}>← Back to Home</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 28, fontWeight: '900', color: colors.text, marginTop: 8 }}>
          Attendance Report
        </Text>
        <Text style={{ color: colors.textMuted, marginTop: 4, fontSize: 14 }}>
          Select a subject to view detailed insights
        </Text>
      </View>

      {/* Overall Stats Card */}
      <View style={{
        marginHorizontal: 20, marginBottom: 16, padding: 20, borderRadius: 22,
        backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
      }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.primary, fontSize: 30, fontWeight: '900' }}>
              {allRecords.length}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 4, letterSpacing: 1 }}>SESSIONS</Text>
          </View>
          <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.08)' }} />
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.success, fontSize: 30, fontWeight: '900' }}>
              {subjects.length}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 4, letterSpacing: 1 }}>SUBJECTS</Text>
          </View>
          <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.08)' }} />
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.secondary, fontSize: 30, fontWeight: '900' }}>
              {enrolledStudents.length}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 4, letterSpacing: 1 }}>STUDENTS</Text>
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
            const hasPhotos = item.records.some(r => !!r.photoUrl);

            return (
              <TouchableOpacity
                style={{
                  marginBottom: 10, padding: 18, borderRadius: 20,
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
                }}
                onPress={() => setSelectedSubject(item)}
                activeOpacity={0.7}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>
                      {item.code}
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 2 }}>
                      {item.name}
                    </Text>
                    <View style={{ flexDirection: 'row', marginTop: 10, gap: 6 }}>
                      <View style={{
                        backgroundColor: 'rgba(0,209,255,0.1)',
                        paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
                      }}>
                        <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '600' }}>
                          {item.totalSessions} sessions
                        </Text>
                      </View>
                      <View style={{
                        backgroundColor: 'rgba(0,224,150,0.1)',
                        paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
                      }}>
                        <Text style={{ color: colors.success, fontSize: 11, fontWeight: '600' }}>
                          {uniqueStudents} students
                        </Text>
                      </View>
                      {hasPhotos && (
                        <View style={{
                          backgroundColor: 'rgba(255, 184, 0, 0.1)',
                          paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
                        }}>
                          <Text style={{ color: '#FFB800', fontSize: 11, fontWeight: '600' }}>📸 Photos</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <View style={{ alignItems: 'center', marginLeft: 12 }}>
                    <Text style={{ color: getColor(avgAtt), fontSize: 26, fontWeight: '900' }}>
                      {avgAtt}%
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: 9, letterSpacing: 1 }}>AVG</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Refresh */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
        <TouchableOpacity
          style={{
            backgroundColor: colors.primary, borderRadius: 14, height: 50,
            justifyContent: 'center', alignItems: 'center',
            elevation: 4, shadowColor: colors.primary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6,
          }}
          onPress={fetchData}
        >
          <Text style={{ color: '#000', fontSize: 15, fontWeight: '800', letterSpacing: 0.5 }}>↻ Refresh</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default AttendanceReport;
