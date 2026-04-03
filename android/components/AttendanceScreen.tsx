import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, Alert,
  Image as RNImage, FlatList, StyleSheet, ScrollView, Dimensions, Modal, TextInput
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import axios from 'axios';
import { db } from '../firebaseConfig';
import { colors, globalStyles } from '../styles';
import { ENDPOINTS } from '../config';

interface AttendanceScreenProps {
  onBack: () => void;
}

const SUBJECTS = [
  { code: 'CSE301', name: 'Data Structures', department: 'Computer Science', semester: 3 },
  { code: 'CSE302', name: 'Operating Systems', department: 'Computer Science', semester: 4 },
  { code: 'CSE303', name: 'Database Systems', department: 'Computer Science', semester: 5 },
  { code: 'CSE304', name: 'Computer Networks', department: 'Computer Science', semester: 6 },
  { code: 'MAT201', name: 'Engineering Mathematics', department: 'General', semester: 2 },
  { code: 'PHY101', name: 'Applied Physics', department: 'General', semester: 1 },
  { code: 'ENG101', name: 'Technical English', department: 'General', semester: 1 },
];

type Phase = 'select-subject' | 'camera' | 'results' | 'review';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const AttendanceScreen: React.FC<AttendanceScreenProps> = ({ onBack }) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('select-subject');
  const [selectedSubject, setSelectedSubject] = useState<typeof SUBJECTS[0] | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [capturedImages, setCapturedImages] = useState<string[]>([]);
  const [annotatedImage, setAnnotatedImage] = useState<string | null>(null);
  const [presentStudents, setPresentStudents] = useState<string[]>([]);
  const [enrolledStudents, setEnrolledStudents] = useState<string[]>([]);
  const [totalFaces, setTotalFaces] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [showFullImage, setShowFullImage] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const cameraRef = useRef<CameraView>(null);

  useEffect(() => {
    if (!permission) requestPermission();
  }, [permission]);

  const takePhoto = async () => {
    if (cameraRef.current && capturedImages.length < 4) {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, base64: true });
      if (photo) {
        setCapturedImages(prev => [...prev, photo.uri]);
      }
    }
  };

  const handleAttendance = async () => {
    if (capturedImages.length === 0) return;
    
    setIsScanning(true);
    setPresentStudents([]);
    setTotalFaces(null);
    setAnnotatedImage(null);

    try {
      const formData = new FormData();
      
      capturedImages.forEach((uri, index) => {
        const uriParts = uri.split('.');
        const fileType = uriParts[uriParts.length - 1];
        // @ts-ignore
        formData.append('files', {
          uri: uri,
          name: `attendance_${index}.${fileType}`,
          type: `image/${fileType}`,
        });
      });

      const response = await axios.post(ENDPOINTS.ATTENDANCE, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 180000, // 3 minutes for multiple photos
      });

      if (response.data.status === 'success') {
        setPresentStudents(response.data.present_students || []);
        setTotalFaces(response.data.total_faces || 0);
        
        if (response.data.annotated_image) {
          setAnnotatedImage(`data:image/jpeg;base64,${response.data.annotated_image}`);
        }
        
        // Fetch students for manual override (filtered by department/semester)
        await fetchCohortStudents();
        setPhase('review');
      } else if (response.data.error?.includes('Liveness Failure')) {
        Alert.alert('🛡️ AI Security Alert', response.data.error, [
          { text: 'Try Again', onPress: () => setPhase('camera') }
        ]);
      } else {
        Alert.alert('Error', response.data.error || 'AI could not process the photos.');
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Server Error', 'Could not connect to the AI backend.');
    } finally {
      setIsScanning(false);
    }
  };

  const fetchCohortStudents = async () => {
    if (!selectedSubject) return;
    try {
      const snapshot = await getDocs(collection(db, 'Students'));
      const students: string[] = [];
      snapshot.forEach((docSnap: any) => {
        const data = docSnap.data();
        if (data.department === selectedSubject.department && data.semester === selectedSubject.semester) {
          students.push(docSnap.id);
        }
      });
      setEnrolledStudents(students.sort());
    } catch (err) {
      console.error('Error fetching students:', err);
    }
  };

  // Save attendance record to Firestore & Send Notifications
  const saveAttendance = async () => {
    if (!selectedSubject || saved) return;

    try {
      const now = new Date();
      const attendanceId = await addDoc(collection(db, 'attendance_records'), {
        subjectCode: selectedSubject.code,
        subjectName: selectedSubject.name,
        date: now.toISOString().split('T')[0],
        time: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        timestamp: now.toISOString(),
        totalFaces: totalFaces,
        presentStudents: presentStudents,
        presentCount: presentStudents.length,
      });

      // Send notifications to present students
      const notificationPromises = presentStudents.map(regNumber => 
        addDoc(collection(db, 'notifications'), {
          to: regNumber,
          type: 'attendance',
          title: 'Attendance Marked ✅',
          message: `You were marked Present in ${selectedSubject.code} today.`,
          timestamp: now.toISOString(),
          read: false,
          subject: selectedSubject.code
        })
      );
      await Promise.all(notificationPromises);

      setSaved(true);
      setPhase('results');
      Alert.alert('✅ Confirmed', `Attendance saved and notifications sent to ${presentStudents.length} students.`);
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Could not save attendance record.');
    }
  };

  const toggleStudent = (regNumber: string) => {
    setPresentStudents(prev => 
      prev.includes(regNumber) 
        ? prev.filter(id => id !== regNumber) 
        : [...prev, regNumber].sort()
    );
  };

  const resetScan = () => {
    setCapturedImages([]);
    setAnnotatedImage(null);
    setPresentStudents([]);
    setTotalFaces(null);
    setSaved(false);
    setPhase('camera');
  };

  // Permission handling
  if (!permission) {
    return <View style={globalStyles.container}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (!permission.granted && phase !== 'select-subject') {
    return (
      <View style={[globalStyles.container, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
        <Text style={{ color: colors.text, textAlign: 'center', marginBottom: 20 }}>
          Camera access is required for attendance scanning.
        </Text>
        <TouchableOpacity style={globalStyles.button} onPress={requestPermission}>
          <Text style={globalStyles.buttonText}>GRANT PERMISSION</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={globalStyles.container}>
      {/* Header */}
      <View style={{ padding: 20 }}>
        <TouchableOpacity onPress={() => phase === 'select-subject' ? onBack() : setPhase('select-subject')}>
          <Text style={{ color: colors.primary, fontSize: 16 }}>
            ← {phase === 'select-subject' ? 'Back to Home' : 'Change Subject'}
          </Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 26, fontWeight: '800', color: colors.text, marginTop: 8 }}>
          Smart Attendance
        </Text>
        {selectedSubject && (
          <View style={{
            alignSelf: 'flex-start', marginTop: 6,
            backgroundColor: 'rgba(0, 209, 255, 0.15)',
            paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8,
          }}>
            <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>
              {selectedSubject.code} — {selectedSubject.name}
            </Text>
          </View>
        )}
      </View>

      {/* ============ PHASE 1: Subject Selection ============ */}
      {phase === 'select-subject' && (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30 }}>
          <View style={[globalStyles.card, { padding: 16, marginBottom: 16 }]}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>
              📚 Select Subject
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 4 }}>
              Choose the class you are taking attendance for.
            </Text>
          </View>

          {SUBJECTS.map((subject) => (
            <TouchableOpacity
              key={subject.code}
              style={[globalStyles.card, {
                marginBottom: 10, padding: 16,
                borderColor: selectedSubject?.code === subject.code ? colors.primary : 'rgba(255,255,255,0.05)',
                borderWidth: selectedSubject?.code === subject.code ? 2 : 1,
              }]}
              onPress={() => setSelectedSubject(subject)}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View>
                  <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>
                    {subject.code}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 2 }}>
                    {subject.name}
                  </Text>
                </View>
                {selectedSubject?.code === subject.code && (
                  <View style={{
                    width: 24, height: 24, borderRadius: 12,
                    backgroundColor: colors.primary,
                    justifyContent: 'center', alignItems: 'center'
                  }}>
                    <Text style={{ color: '#000', fontWeight: 'bold', fontSize: 14 }}>✓</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={[globalStyles.button, {
              marginTop: 10,
              opacity: selectedSubject ? 1 : 0.4,
            }]}
            onPress={() => selectedSubject && setPhase('camera')}
            disabled={!selectedSubject}
          >
            <Text style={globalStyles.buttonText}>OPEN CAMERA →</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ============ PHASE 2: Camera Multi-Capture ============ */}
      {phase === 'camera' && (
        <View style={{ flex: 1, marginHorizontal: 20 }}>
          <View style={{ flex: 1, borderRadius: 24, overflow: 'hidden', backgroundColor: '#000' }}>
            <CameraView style={{ flex: 1 }} facing="back" ref={cameraRef} />
            
            {/* Capture Progress Overlay */}
            <View style={{
              position: 'absolute', top: 20, left: 20, right: 20,
              flexDirection: 'row', gap: 8, justifyContent: 'center'
            }}>
              {[1, 2, 3, 4].map(n => (
                <View key={n} style={{
                  height: 6, flex: 1, borderRadius: 3,
                  backgroundColor: n <= capturedImages.length ? colors.primary : 'rgba(255,255,255,0.2)'
                }} />
              ))}
            </View>

            {/* Liveness Guidance */}
            <View style={{
              position: 'absolute', top: 40, left: 20, right: 20,
              alignItems: 'center'
            }}>
              <View style={{ backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.primary }}>
                 <Text style={{ color: colors.primary, fontSize: 10, fontWeight: '900' }}>🛡️ AI LIVENESS ACTIVE</Text>
              </View>
              <Text style={{ color: '#fff', fontSize: 12, marginTop: 10, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 4 }}>
                Ensure student is blink/moving. Do not scan photos of screens.
              </Text>
            </View>

            {isScanning && (
              <View style={{
                ...StyleSheet.absoluteFillObject,
                backgroundColor: 'rgba(0,0,0,0.85)',
                justifyContent: 'center', alignItems: 'center', padding: 20
              }}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={{ color: colors.text, marginTop: 20, fontSize: 18, fontWeight: 'bold' }}>
                  AI IS ANALYZING {capturedImages.length} PHOTOS...
                </Text>
                <Text style={{ color: colors.textMuted, marginTop: 8, fontSize: 13, textAlign: 'center' }}>
                  Aggregating detections for maximum accuracy.
                </Text>
              </View>
            )}

            {!isScanning && (
              <View style={{ position: 'absolute', bottom: 20, left: 20, right: 20 }}>
                {capturedImages.length > 0 && (
                  <TouchableOpacity
                    style={[globalStyles.button, { marginBottom: 12 }]}
                    onPress={handleAttendance}
                  >
                    <Text style={globalStyles.buttonText}>🚀 PROCESS {capturedImages.length} PHOTO{capturedImages.length > 1 ? 'S' : ''}</Text>
                  </TouchableOpacity>
                )}
                
                {capturedImages.length < 4 ? (
                  <TouchableOpacity
                    style={[globalStyles.button, { backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: colors.primary }]}
                    onPress={takePhoto}
                  >
                    <Text style={[globalStyles.buttonText, { color: colors.primary }]}>
                      📸 {capturedImages.length === 0 ? 'START SCAN' : `TAKE PHOTO ${capturedImages.length + 1}/4`}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={{ color: colors.textMuted, textAlign: 'center', marginBottom: 10 }}>
                    Maximum 4 photos reached. Click above to process.
                  </Text>
                )}
              </View>
            )}
          </View>

          {/* Captured Thumbnails */}
          {capturedImages.length > 0 && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              {capturedImages.map((uri, i) => (
                <View key={i} style={{ width: 60, height: 60, borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: colors.primary }}>
                  <RNImage source={{ uri }} style={{ width: '100%', height: '100%' }} />
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* ============ PHASE REVIEW: Manual Override ============ */}
      {phase === 'review' && (
        <ScrollView style={{ flex: 1, paddingHorizontal: 20 }} contentContainerStyle={{ paddingBottom: 30 }}>
          <View style={[globalStyles.card, { padding: 16, marginBottom: 16 }]}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>Review Attendance</Text>
            <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 4 }}>
              AI found {presentStudents.length} students. You can manually adjust the list before confirming.
            </Text>
          </View>

          {/* Filtering Context Info */}
          <View style={{ backgroundColor: 'rgba(0, 209, 255, 0.1)', padding: 12, borderRadius: 12, marginBottom: 16 }}>
            <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>
              COHORT FILTER ACTIVE: {selectedSubject?.department} • SEMESTER {selectedSubject?.semester}
            </Text>
          </View>

          {/* present Students List */}
          <Text style={{ color: colors.textMuted, fontSize: 11, letterSpacing: 1, marginBottom: 8 }}>PRESENT LIST</Text>
          {presentStudents.map(id => (
            <View key={id} style={[globalStyles.card, { padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center' }]}>
              <Text style={{ color: colors.text, fontSize: 15, flex: 1 }}>{id}</Text>
              <TouchableOpacity onPress={() => toggleStudent(id)} style={{ padding: 8 }}>
                <Text style={{ color: colors.error, fontWeight: 'bold' }}>REMOVE</Text>
              </TouchableOpacity>
            </View>
          ))}

          {/* Add Student Button */}
          <TouchableOpacity 
            style={[globalStyles.button, { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.success, marginTop: 10 }]}
            onPress={() => setShowAddModal(true)}
          >
            <Text style={[globalStyles.buttonText, { color: colors.success, fontSize: 14 }]}>+ ADD MISSING STUDENT</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[globalStyles.button, { marginTop: 20, backgroundColor: colors.success }]}
            onPress={saveAttendance}
          >
            <Text style={[globalStyles.buttonText, { color: '#000' }]}>✅ CONFIRM & SAVE</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ============ PHASE 3: Results with Annotated Image ============ */}
      {phase === 'results' && (
        <ScrollView style={{ flex: 1, paddingHorizontal: 20 }} contentContainerStyle={{ paddingBottom: 30 }}>
          
          {/* Summary Card */}
          <View style={[globalStyles.card, { alignItems: 'center', marginBottom: 16, borderColor: colors.success, borderWidth: 1 }]}>
            <Text style={{ fontSize: 40, marginBottom: 8 }}>✅</Text>
            <Text style={{ color: colors.text, fontSize: 22, fontWeight: '900' }}>Attendance Saved</Text>
            <Text style={{ color: colors.textMuted, fontSize: 14, marginTop: 4, textAlign: 'center' }}>
              Records for {presentStudents.length} students have been finalized and notifications sent.
            </Text>
          </View>

          {/* Annotated Image Preview */}
          {annotatedImage && (
            <TouchableOpacity 
              onPress={() => setShowFullImage(true)}
              style={[globalStyles.card, { 
                marginBottom: 12, padding: 0, overflow: 'hidden',
                borderColor: 'rgba(0, 209, 255, 0.3)', borderWidth: 1,
              }]}
            >
              <RNImage
                source={{ uri: annotatedImage }}
                style={{
                  width: SCREEN_WIDTH - 40,
                  height: (SCREEN_WIDTH - 40) * 0.65,
                  borderRadius: 16,
                }}
                resizeMode="contain"
              />
              <View style={{
                position: 'absolute', bottom: 8, right: 8,
                backgroundColor: 'rgba(0,0,0,0.7)',
                paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
              }}>
                <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '600' }}>
                  🔍 Tap to zoom
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {/* present Students List */}
          <Text style={{ color: colors.textMuted, fontSize: 11, letterSpacing: 1, marginBottom: 8, marginLeft: 4 }}>
            FINAL PRESENT LIST ({presentStudents.length})
          </Text>
          {presentStudents.map((item, index) => (
            <View key={item} style={[globalStyles.card, {
              padding: 14, marginBottom: 6,
              backgroundColor: 'rgba(0, 224, 150, 0.06)',
            }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{item}</Text>
                <Text style={{ color: colors.success, fontSize: 12, marginLeft: 'auto', fontWeight: '600' }}>✓ RECORDED</Text>
              </View>
            </View>
          ))}

          <TouchableOpacity
            style={[globalStyles.button, { marginTop: 10 }]}
            onPress={() => setPhase('select-subject')}
          >
            <Text style={globalStyles.buttonText}>DONE</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Add Student Modal */}
      <Modal visible={showAddModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'flex-end' }}>
          <View style={{ 
            backgroundColor: colors.cardBackground, 
            height: '80%', 
            borderTopLeftRadius: 30, borderTopRightRadius: 30,
            padding: 20
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ color: colors.text, fontSize: 20, fontWeight: 'bold' }}>Add Missing Student</Text>
              <TouchableOpacity onPress={() => { setShowAddModal(false); setSearchQuery(''); }}>
                <Text style={{ color: colors.primary, fontWeight: '700' }}>CLOSE</Text>
              </TouchableOpacity>
            </View>

            <View style={[globalStyles.input, { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15 }]}>
              <Text style={{ marginRight: 10 }}>🔍</Text>
              <TextInput
                style={{ flex: 1, color: colors.text, height: '100%' }}
                placeholder="Search by Reg Number..."
                placeholderTextColor={colors.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
              />
            </View>
            
            <FlatList
              data={enrolledStudents.filter(s => 
                !presentStudents.includes(s) && 
                s.toLowerCase().includes(searchQuery.toLowerCase())
              )}
              keyExtractor={item => item}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={{ 
                    paddingVertical: 15, borderBottomWidth: 1, 
                    borderBottomColor: 'rgba(255,255,255,0.05)',
                    flexDirection: 'row', justifyContent: 'space-between'
                  }}
                  onPress={() => {
                    toggleStudent(item);
                    setShowAddModal(false);
                  }}
                >
                  <Text style={{ color: colors.text, fontSize: 16 }}>{item}</Text>
                  <Text style={{ color: colors.success, fontWeight: 'bold' }}>ADD +</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={() => (
                <Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 40 }}>
                  All students in this cohort are already marked present.
                </Text>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Full-Screen Image Modal */}
      <Modal visible={showFullImage} transparent animationType="fade">
        <View style={{
          flex: 1, backgroundColor: 'rgba(0,0,0,0.95)',
          justifyContent: 'center', alignItems: 'center',
        }}>
          <TouchableOpacity
            style={{ position: 'absolute', top: 50, right: 20, zIndex: 10 }}
            onPress={() => setShowFullImage(false)}
          >
            <View style={{
              backgroundColor: 'rgba(255,255,255,0.15)',
              padding: 12, borderRadius: 20,
            }}>
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}>✕</Text>
            </View>
          </TouchableOpacity>
          
          {annotatedImage && (
            <RNImage
              source={{ uri: annotatedImage }}
              style={{
                width: SCREEN_WIDTH - 20,
                height: '80%',
              }}
              resizeMode="contain"
            />
          )}

          {/* Legend in fullscreen */}
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
};

export default AttendanceScreen;
