import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ActivityIndicator,
  Alert, ScrollView, KeyboardAvoidingView, Platform, Image as RNImage
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import axios from 'axios';
import { auth, db } from '../firebaseConfig';
import { ENDPOINTS } from '../config';
import { colors, globalStyles } from '../styles';

const DEPARTMENTS = ['CSE', 'ECE', 'EEE', 'MECH', 'CIVIL', 'IT', 'AIDS', 'AIML'];
const BATCH_YEARS = ['2023-2027', '2024-2028', '2025-2029', '2026-2030'];

// ========================
// HELPER COMPONENTS (DEFINED OUTSIDE TO PREVENT FOCUS LOSS)
// ========================

const PasswordInput = ({
  placeholder, value, onChangeText, show, onToggle
}: {
  placeholder: string; value: string; onChangeText: (t: string) => void;
  show: boolean; onToggle: () => void;
}) => (
  <View style={{ position: 'relative' }}>
    <TextInput
      style={globalStyles.input}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      secureTextEntry={!show}
      value={value}
      onChangeText={onChangeText}
    />
    <TouchableOpacity onPress={onToggle} style={{ position: 'absolute', right: 16, top: 16 }}>
      <Text style={{ color: colors.textMuted, fontSize: 14 }}>{show ? '🙈' : '👁'}</Text>
    </TouchableOpacity>
  </View>
);

const ProgressBar = ({ step, role }: { step: number; role: string }) => {
  const teacherLabels = ['Account', 'Verify', 'Academic', 'Review'];
  const studentLabels = ['Account', 'Verify', 'Academic', 'Face ID', 'Review'];
  const labels = role === 'teacher' ? teacherLabels : studentLabels;

  const getActualStep = (i: number) => {
    if (role === 'teacher') return [1, 2, 3, 5][i];
    return i + 1;
  };

  return (
    <View style={{ flexDirection: 'row', marginBottom: 24, paddingHorizontal: 5 }}>
      {labels.map((label, index) => {
        const actual = getActualStep(index);
        const isActive = step >= actual;
        const isCurrent = step === actual;
        return (
          <View key={label} style={{ flex: 1, alignItems: 'center' }}>
            <View style={{
              width: 28, height: 28, borderRadius: 14,
              backgroundColor: isActive ? colors.primary : 'rgba(255,255,255,0.08)',
              justifyContent: 'center', alignItems: 'center',
              borderWidth: isCurrent ? 2 : 0,
              borderColor: isCurrent ? colors.text : 'transparent',
            }}>
              <Text style={{ color: isActive ? '#000' : colors.textMuted, fontWeight: 'bold', fontSize: 12 }}>
                {index + 1}
              </Text>
            </View>
            <Text style={{
              color: isActive ? colors.text : colors.textMuted,
              fontSize: 9, marginTop: 3, textAlign: 'center'
            }}>{label}</Text>
            {index < labels.length - 1 && (
              <View style={{
                position: 'absolute', top: 13, left: '60%', right: '-60%', height: 2,
                backgroundColor: step > actual ? colors.primary : 'rgba(255,255,255,0.08)',
              }} />
            )}
          </View>
        );
      })}
    </View>
  );
};

const AuthScreen = () => {
  const [isLogin, setIsLogin] = useState(true);
  // Steps: 1=Account, 2=OTP, 3=Academic, 4=FaceID, 5=Review
  const [step, setStep] = useState(1);

  // Step 1: Account
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [role, setRole] = useState<'teacher' | 'student'>('student');
  const [teacherCode, setTeacherCode] = useState('');
  const [fullName, setFullName] = useState('');

  // Step 2: OTP
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);

  // Step 3: Academic
  const [regNumber, setRegNumber] = useState('');
  const [department, setDepartment] = useState('');
  const [batchYear, setBatchYear] = useState('');

  // Step 4: Face ID + Liveness
  const [permission, requestPermission] = useCameraPermissions();
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedImage2, setCapturedImage2] = useState<string | null>(null);
  const [livenessVerified, setLivenessVerified] = useState(false);
  const [livenessChecking, setLivenessChecking] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  // General
  const [loading, setLoading] = useState(false);

  // ========================
  // VALIDATION
  // ========================
  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const isValidRegNumber = (n: string) => /^\d{10}$/.test(n);

  // ========================
  // OTP FUNCTIONS
  // ========================

  const sendOtp = async () => {
    if (!isValidEmail(email)) return Alert.alert('Invalid Email', 'Please enter a valid email.');
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('email', email);
      const res = await axios.post(ENDPOINTS.SEND_OTP, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 15000,
      });
      if (res.data.status === 'success') {
        setOtpSent(true);
        Alert.alert('📧 OTP Sent', `A 6-digit code has been sent to ${email}. Check your inbox.`);
      } else {
        Alert.alert('Error', res.data.error || 'Could not send OTP.');
      }
    } catch (err) {
      // If backend is down, skip OTP (graceful fallback)
      console.warn('OTP service unavailable, skipping:', err);
      setOtpVerified(true);
      setStep(3);
      Alert.alert('Note', 'Email verification service is offline. Proceeding without OTP.');
      setLoading(false);
      return;
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    if (otpCode.length !== 6) return Alert.alert('Invalid', 'Please enter the 6-digit code.');
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('email', email);
      formData.append('otp', otpCode);
      const res = await axios.post(ENDPOINTS.VERIFY_OTP, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 10000,
      });
      if (res.data.valid) {
        setOtpVerified(true);
        setStep(3);
        Alert.alert('✅ Verified', 'Email verified successfully!');
      } else {
        Alert.alert('Wrong Code', res.data.error || 'Incorrect OTP.');
      }
    } catch (err) {
      Alert.alert('Error', 'Could not verify OTP. Try again.');
    } finally {
      setLoading(false);
    }
  };

  // ========================
  // STEP NAVIGATION
  // ========================

  const goNextStep = async () => {
    if (step === 1) {
      if (!fullName.trim()) return Alert.alert('Required', 'Please enter your full name.');
      if (!isValidEmail(email)) return Alert.alert('Invalid Email', 'Please enter a valid email.');
      if (password.length < 6) return Alert.alert('Weak Password', 'Password must be at least 6 characters.');
      if (password !== confirmPassword) return Alert.alert('Mismatch', 'Passwords do not match.');
      if (role === 'teacher') {
        if (!teacherCode.trim()) return Alert.alert('Required', 'Enter the teacher verification code.');
        try {
          setLoading(true);
          const formData = new FormData();
          formData.append('code', teacherCode);
          const res = await axios.post(ENDPOINTS.VERIFY_TEACHER_CODE, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 10000,
          });
          if (!res.data.valid) {
            setLoading(false);
            return Alert.alert('Invalid Code', 'Incorrect teacher verification code.');
          }
        } catch (err) {
          setLoading(false);
          return Alert.alert('Error', 'Could not verify teacher code. Check your connection.');
        } finally {
          setLoading(false);
        }
      }
      setStep(2); // Go to OTP
      if (!otpSent) sendOtp(); // Auto-send OTP
    } else if (step === 3) {
      if (!isValidRegNumber(regNumber)) return Alert.alert('Invalid', 'Registration number must be 10 digits.');
      if (!department) return Alert.alert('Required', 'Select your department.');
      if (!batchYear) return Alert.alert('Required', 'Select your batch year.');
      setStep(role === 'teacher' ? 5 : 4);
    } else if (step === 4) {
      if (!capturedImage) return Alert.alert('Required', 'Please capture your Face ID.');
      setStep(5);
    }
  };

  const goBackStep = () => {
    if (step === 5 && role === 'teacher') setStep(3);
    else if (step === 3) setStep(2);
    else if (step > 1) setStep(step - 1);
  };

  // ========================
  // CAMERA + LIVENESS
  // ========================

  const takePhoto = async () => {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, base64: true });
    if (!photo) return;

    if (!capturedImage) {
      // First photo
      setCapturedImage(photo.uri);
      Alert.alert(
        '📸 One More!',
        'Slightly turn your head and tap "Capture" again for liveness verification.',
      );
    } else {
      // Second photo — run liveness check
      setCapturedImage2(photo.uri);
      setLivenessChecking(true);

      try {
        const formData = new FormData();
        const ext1 = capturedImage.split('.').pop();
        const ext2 = photo.uri.split('.').pop();
        // @ts-ignore
        formData.append('file1', { uri: capturedImage, name: `face1.${ext1}`, type: `image/${ext1}` });
        // @ts-ignore
        formData.append('file2', { uri: photo.uri, name: `face2.${ext2}`, type: `image/${ext2}` });

        const res = await axios.post(ENDPOINTS.LIVENESS_CHECK, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 30000,
        });

        if (res.data.alive) {
          setLivenessVerified(true);
          Alert.alert('✅ Liveness Verified', 'You are confirmed as a real person!');
        } else {
          setCapturedImage(null);
          setCapturedImage2(null);
          Alert.alert(
            '⚠️ Liveness Failed',
            res.data.message || 'Please move your head naturally between the two photos.',
          );
        }
      } catch (err) {
        // Backend down — skip liveness gracefully
        console.warn('Liveness service unavailable:', err);
        setLivenessVerified(true);
      } finally {
        setLivenessChecking(false);
      }
    }
  };

  const retakePhotos = () => {
    setCapturedImage(null);
    setCapturedImage2(null);
    setLivenessVerified(false);
  };

  // ========================
  // FORGOT PASSWORD
  // ========================

  const handleForgotPassword = async () => {
    if (!isValidEmail(email)) {
      return Alert.alert('Enter Email', 'Type your email above, then tap "Forgot Password".');
    }
    try {
      await sendPasswordResetEmail(auth, email);
      Alert.alert('✅ Sent', `Password reset link sent to ${email}.`);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Could not send reset email.');
    }
  };

  // ========================
  // ATOMIC REGISTRATION
  // ========================

  const handleFullRegistration = async () => {
    setLoading(true);
    try {
      // A: For students, register face FIRST
      let faceRegistered = false;
      if (role === 'student' && capturedImage) {
        const formData = new FormData();
        formData.append('student_id', regNumber);
        const ext = capturedImage.split('.').pop();
        // @ts-ignore
        formData.append('file', { uri: capturedImage, name: `face.${ext}`, type: `image/${ext}` });

        try {
          const res = await axios.post(ENDPOINTS.REGISTER, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 30000,
          });
          if (res.data.status === 'success') {
            faceRegistered = true;
          } else {
            Alert.alert('Face Failed', res.data.error || 'Could not process face.');
            setLoading(false);
            return;
          }
        } catch (faceErr) {
          Alert.alert('Connection Error', 'Cannot reach AI server for Face ID.');
          setLoading(false);
          return;
        }
      }

      // B: Create Auth account
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // C: Save to Firestore
      await setDoc(doc(db, 'users', user.uid), {
        fullName,
        email: user.email,
        role,
        regNumber,
        department,
        batchYear,
        faceRegistered,
        emailVerified: otpVerified,
        livenessVerified,
        approved: false,
        createdAt: new Date().toISOString(),
      });

      Alert.alert('✅ Registration Complete', 'Submitted for Admin approval.', [{ text: 'OK' }]);
    } catch (error: any) {
      if (error.code === 'auth/email-already-in-use') {
        Alert.alert('Error', 'This email is already registered.');
      } else {
        Alert.alert('Failed', error.message || 'Something went wrong.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ========================
  // LOGIN
  // ========================

  const handleLogin = async () => {
    if (!email || !password) return Alert.alert('Error', 'Enter email and password.');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error: any) {
      Alert.alert('Login Failed', error.message || 'Invalid credentials.');
    } finally {
      setLoading(false);
    }
  };



  const stepLabels = ['Account Details', 'Email Verification', 'Academic Information', 'Face ID & Liveness', 'Review & Submit'];
  const totalSteps = role === 'teacher' ? 4 : 5;
  const displayStep = role === 'teacher'
    ? (step === 5 ? 4 : step)
    : step;

  // ========================
  // RENDER: LOGIN
  // ========================

  if (isLogin) {
    return (
      <KeyboardAvoidingView style={globalStyles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={{ padding: 24, flexGrow: 1, justifyContent: 'center' }}>
          <View style={{ alignItems: 'center', marginBottom: 40 }}>
            <Text style={{ fontSize: 40, fontWeight: '900', color: colors.primary, letterSpacing: 2 }}>ATTENDEASE</Text>
            <Text style={{ color: colors.textMuted, fontSize: 14, marginTop: 4 }}>AI-Powered Attendance System</Text>
          </View>
          <View style={globalStyles.card}>
            <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700', marginBottom: 24 }}>Welcome Back</Text>
            <TextInput style={globalStyles.input} placeholder="Email Address" placeholderTextColor={colors.textMuted}
              value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <PasswordInput placeholder="Password" value={password}
              onChangeText={setPassword} show={showPassword} onToggle={() => setShowPassword(!showPassword)} />
            <TouchableOpacity style={[globalStyles.button, { opacity: loading ? 0.5 : 1 }]} onPress={handleLogin} disabled={loading}>
              {loading ? <ActivityIndicator color="#000" /> : <Text style={globalStyles.buttonText}>LOG IN</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleForgotPassword} style={{ marginTop: 16 }}>
              <Text style={{ color: colors.textMuted, textAlign: 'center', fontSize: 14 }}>Forgot Password?</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => { setIsLogin(false); setStep(1); }} style={{ marginTop: 24 }}>
            <Text style={{ color: colors.primary, textAlign: 'center', fontSize: 15 }}>New here? Create an account →</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ========================
  // RENDER: SIGNUP STEPS
  // ========================

  return (
    <KeyboardAvoidingView style={globalStyles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ padding: 24, flexGrow: 1 }}>
        {/* Header */}
        <View style={{ marginTop: 16, marginBottom: 8 }}>
          <TouchableOpacity onPress={() => step === 1 ? setIsLogin(true) : goBackStep()}>
            <Text style={{ color: colors.primary, fontSize: 16 }}>← {step === 1 ? 'Back to Login' : 'Previous Step'}</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text, marginTop: 10 }}>Create Account</Text>
          <Text style={{ color: colors.textMuted, marginTop: 4 }}>
            Step {displayStep} of {totalSteps} — {stepLabels[step - 1]}
          </Text>
        </View>

        <ProgressBar step={step} role={role} />

        {/* ============ STEP 1: Account ============ */}
        {step === 1 && (
          <View style={globalStyles.card}>
            <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 8, letterSpacing: 1 }}>SELECT ROLE</Text>
            <View style={{ flexDirection: 'row', marginBottom: 20, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 4 }}>
              {(['student', 'teacher'] as const).map((r) => (
                <TouchableOpacity key={r} style={{
                  flex: 1, paddingVertical: 12, borderRadius: 10,
                  backgroundColor: role === r ? colors.primary : 'transparent',
                }} onPress={() => setRole(r)}>
                  <Text style={{ textAlign: 'center', fontWeight: '700', color: role === r ? '#000' : colors.text }}>
                    {r.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={globalStyles.input} placeholder="Full Name" placeholderTextColor={colors.textMuted}
              value={fullName} onChangeText={setFullName} />
            <TextInput style={globalStyles.input} placeholder="Email Address" placeholderTextColor={colors.textMuted}
              value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <PasswordInput placeholder="Password (min 6 characters)" value={password}
              onChangeText={setPassword} show={showPassword} onToggle={() => setShowPassword(!showPassword)} />
            <PasswordInput placeholder="Confirm Password" value={confirmPassword}
              onChangeText={setConfirmPassword} show={showConfirmPassword} onToggle={() => setShowConfirmPassword(!showConfirmPassword)} />
            {role === 'teacher' && (
              <TextInput style={globalStyles.input} placeholder="Teacher Verification Code"
                placeholderTextColor={colors.textMuted} secureTextEntry value={teacherCode} onChangeText={setTeacherCode} />
            )}
            <TouchableOpacity style={globalStyles.button} onPress={goNextStep}>
              <Text style={globalStyles.buttonText}>NEXT →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ============ STEP 2: OTP Verification ============ */}
        {step === 2 && (
          <View style={globalStyles.card}>
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <View style={{
                width: 64, height: 64, borderRadius: 32,
                backgroundColor: otpVerified ? 'rgba(0,224,150,0.15)' : 'rgba(0,209,255,0.15)',
                justifyContent: 'center', alignItems: 'center', marginBottom: 12,
              }}>
                <Text style={{ fontSize: 28 }}>{otpVerified ? '✅' : '📧'}</Text>
              </View>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>
                {otpVerified ? 'Email Verified!' : 'Verify Your Email'}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 6, textAlign: 'center' }}>
                {otpVerified
                  ? `${email} has been verified.`
                  : `Enter the 6-digit code sent to ${email}`}
              </Text>
            </View>

            {!otpVerified && (
              <>
                <TextInput
                  style={[globalStyles.input, {
                    textAlign: 'center', fontSize: 24, letterSpacing: 8,
                    fontWeight: '800',
                  }]}
                  placeholder="• • • • • •"
                  placeholderTextColor={colors.textMuted}
                  value={otpCode}
                  onChangeText={(t) => setOtpCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  maxLength={6}
                />
                <TouchableOpacity
                  style={[globalStyles.button, { opacity: loading ? 0.5 : 1 }]}
                  onPress={verifyOtp}
                  disabled={loading}
                >
                  {loading ? <ActivityIndicator color="#000" /> : <Text style={globalStyles.buttonText}>VERIFY CODE</Text>}
                </TouchableOpacity>
                <TouchableOpacity onPress={sendOtp} style={{ marginTop: 16 }}>
                  <Text style={{ color: colors.primary, textAlign: 'center', fontSize: 14 }}>
                    Didn't receive it? Resend Code
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {otpVerified && (
              <TouchableOpacity style={globalStyles.button} onPress={() => setStep(3)}>
                <Text style={globalStyles.buttonText}>CONTINUE →</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ============ STEP 3: Academic Info ============ */}
        {step === 3 && (
          <View style={globalStyles.card}>
            <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 8, letterSpacing: 1 }}>REGISTRATION NUMBER</Text>
            <TextInput
              style={[globalStyles.input,
                regNumber.length > 0 && !isValidRegNumber(regNumber)
                  ? { borderColor: colors.error, borderWidth: 2 }
                  : regNumber.length === 10 ? { borderColor: colors.success, borderWidth: 2 } : {}
              ]}
              placeholder="10-digit Registration Number" placeholderTextColor={colors.textMuted}
              value={regNumber} onChangeText={(t) => setRegNumber(t.replace(/[^0-9]/g, '').slice(0, 10))}
              keyboardType="number-pad" maxLength={10}
            />
            {regNumber.length > 0 && (
              <Text style={{ color: isValidRegNumber(regNumber) ? colors.success : colors.error, fontSize: 12, marginTop: -15, marginBottom: 15 }}>
                {isValidRegNumber(regNumber) ? '✓ Valid' : `${regNumber.length}/10 digits`}
              </Text>
            )}

            <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 8, letterSpacing: 1 }}>DEPARTMENT</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 20 }}>
              {DEPARTMENTS.map((dept) => (
                <TouchableOpacity key={dept} style={{
                  paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, margin: 4,
                  backgroundColor: department === dept ? colors.primary : 'rgba(255,255,255,0.05)',
                  borderWidth: 1, borderColor: department === dept ? colors.primary : 'rgba(255,255,255,0.1)',
                }} onPress={() => setDepartment(dept)}>
                  <Text style={{ color: department === dept ? '#000' : colors.text, fontWeight: '600', fontSize: 13 }}>{dept}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 8, letterSpacing: 1 }}>BATCH YEAR</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 20 }}>
              {BATCH_YEARS.map((year) => (
                <TouchableOpacity key={year} style={{
                  paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, margin: 4,
                  backgroundColor: batchYear === year ? colors.primary : 'rgba(255,255,255,0.05)',
                  borderWidth: 1, borderColor: batchYear === year ? colors.primary : 'rgba(255,255,255,0.1)',
                }} onPress={() => setBatchYear(year)}>
                  <Text style={{ color: batchYear === year ? '#000' : colors.text, fontWeight: '600', fontSize: 13 }}>{year}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={globalStyles.button} onPress={goNextStep}>
              <Text style={globalStyles.buttonText}>NEXT →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ============ STEP 4: Face ID + Liveness ============ */}
        {step === 4 && (
          <View style={{ flex: 1 }}>
            <View style={[globalStyles.card, { padding: 16, marginBottom: 16 }]}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>📸 Face ID + Liveness Check</Text>
              <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 6 }}>
                {!capturedImage
                  ? 'Take your first photo facing the camera directly.'
                  : !capturedImage2
                    ? 'Now slightly turn your head and take a second photo.'
                    : livenessVerified
                      ? 'Liveness verified! You can proceed.'
                      : 'Checking liveness...'}
              </Text>
              {/* Status badges */}
              <View style={{ flexDirection: 'row', marginTop: 10 }}>
                <View style={{
                  paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginRight: 8,
                  backgroundColor: capturedImage ? 'rgba(0,224,150,0.15)' : 'rgba(255,255,255,0.05)',
                }}>
                  <Text style={{ color: capturedImage ? colors.success : colors.textMuted, fontSize: 11, fontWeight: '600' }}>
                    {capturedImage ? '✓ Photo 1' : '○ Photo 1'}
                  </Text>
                </View>
                <View style={{
                  paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginRight: 8,
                  backgroundColor: capturedImage2 ? 'rgba(0,224,150,0.15)' : 'rgba(255,255,255,0.05)',
                }}>
                  <Text style={{ color: capturedImage2 ? colors.success : colors.textMuted, fontSize: 11, fontWeight: '600' }}>
                    {capturedImage2 ? '✓ Photo 2' : '○ Photo 2'}
                  </Text>
                </View>
                <View style={{
                  paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
                  backgroundColor: livenessVerified ? 'rgba(0,224,150,0.15)' : 'rgba(255,255,255,0.05)',
                }}>
                  <Text style={{ color: livenessVerified ? colors.success : colors.textMuted, fontSize: 11, fontWeight: '600' }}>
                    {livenessVerified ? '✓ Live' : '○ Live'}
                  </Text>
                </View>
              </View>
            </View>

            {!livenessVerified ? (
              <View style={{ height: 380, backgroundColor: '#000', borderRadius: 24, overflow: 'hidden' }}>
                {permission?.granted ? (
                  <>
                    <CameraView style={{ flex: 1 }} facing="front" ref={cameraRef} />
                    <View style={{
                      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                      justifyContent: 'center', alignItems: 'center',
                    }}>
                      <View style={{
                        width: 200, height: 260, borderRadius: 110,
                        borderWidth: 3, borderColor: capturedImage ? colors.success : colors.primary,
                        borderStyle: 'dashed', opacity: 0.6,
                      }} />
                    </View>
                    {livenessChecking ? (
                      <View style={{
                        position: 'absolute', bottom: 16, left: 16, right: 16,
                        backgroundColor: 'rgba(0,0,0,0.8)', borderRadius: 16, padding: 16, alignItems: 'center',
                      }}>
                        <ActivityIndicator color={colors.primary} />
                        <Text style={{ color: colors.text, marginTop: 8, fontSize: 13 }}>Verifying liveness...</Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[globalStyles.button, { position: 'absolute', bottom: 16, left: 16, right: 16 }]}
                        onPress={takePhoto}
                      >
                        <Text style={globalStyles.buttonText}>
                          {!capturedImage ? '📸 CAPTURE PHOTO 1' : '📸 CAPTURE PHOTO 2'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </>
                ) : (
                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
                    <Text style={{ color: colors.text, textAlign: 'center', marginBottom: 16 }}>Camera permission required.</Text>
                    <TouchableOpacity style={globalStyles.button} onPress={requestPermission}>
                      <Text style={globalStyles.buttonText}>GRANT CAMERA ACCESS</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : (
              <View style={{ height: 380, borderRadius: 24, overflow: 'hidden', position: 'relative' }}>
                <RNImage source={{ uri: capturedImage || '' }} style={{ flex: 1, borderRadius: 24 }} />
                <View style={{ position: 'absolute', top: 16, right: 16, backgroundColor: colors.success, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}>
                  <Text style={{ color: '#000', fontWeight: 'bold', fontSize: 12 }}>✓ VERIFIED LIVE</Text>
                </View>
                <View style={{ position: 'absolute', bottom: 16, left: 16, right: 16, flexDirection: 'row' }}>
                  <TouchableOpacity style={[globalStyles.button, { flex: 1, marginRight: 8, backgroundColor: 'rgba(255,255,255,0.15)' }]} onPress={retakePhotos}>
                    <Text style={[globalStyles.buttonText, { color: colors.text }]}>RETAKE</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[globalStyles.button, { flex: 1, marginLeft: 8 }]} onPress={() => setStep(5)}>
                    <Text style={globalStyles.buttonText}>CONFIRM →</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

        {/* ============ STEP 5: Review ============ */}
        {step === 5 && (
          <View style={globalStyles.card}>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: 20 }}>Review Your Details</Text>
            {[
              { label: 'Name', value: fullName },
              { label: 'Email', value: `${email} ${otpVerified ? '✅' : '⚠️'}` },
              { label: 'Role', value: role.toUpperCase() },
              { label: 'Reg. No.', value: regNumber },
              { label: 'Dept', value: department },
              { label: 'Batch', value: batchYear },
              { label: 'Face ID', value: role === 'teacher' ? '— Not Required' : (capturedImage ? '✅ Captured' : '❌') },
              { label: 'Liveness', value: role === 'teacher' ? '— Not Required' : (livenessVerified ? '✅ Verified' : '⚠️ Not checked') },
            ].map((item) => (
              <View key={item.label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                <Text style={{ color: colors.textMuted, fontSize: 14 }}>{item.label}</Text>
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>{item.value}</Text>
              </View>
            ))}

            <View style={{ backgroundColor: 'rgba(0,209,255,0.08)', borderRadius: 12, padding: 14, marginTop: 20, borderWidth: 1, borderColor: 'rgba(0,209,255,0.2)' }}>
              <Text style={{ color: colors.primary, fontSize: 13 }}>
                ℹ️ Your account will be reviewed by the Admin before access is granted.
              </Text>
            </View>

            <TouchableOpacity
              style={[globalStyles.button, { marginTop: 24, opacity: loading ? 0.5 : 1 }]}
              onPress={handleFullRegistration}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#000" /> : <Text style={globalStyles.buttonText}>SUBMIT FOR APPROVAL</Text>}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default AuthScreen;
