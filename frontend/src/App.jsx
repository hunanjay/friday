import React from 'react';
import { RouterProvider } from 'react-router-dom';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { ThemeProvider } from './context/ThemeContext';
import { router } from './router';
import './i18n';
import './App.css';

function App() {
  return (
    <ThemeProvider>
      <WorkspaceProvider>
        <RouterProvider router={router} />
      </WorkspaceProvider>
    </ThemeProvider>
  );
}

export default App;
