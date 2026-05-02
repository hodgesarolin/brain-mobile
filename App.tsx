import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { AuthContext, useAuthProvider } from './src/hooks/useAuth';
import { AppNavigator } from './src/navigation/AppNavigator';

export default function App() {
  const auth = useAuthProvider();

  return (
    <AuthContext.Provider value={auth}>
      <StatusBar style="light" />
      <AppNavigator />
    </AuthContext.Provider>
  );
}
