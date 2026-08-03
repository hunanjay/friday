import React from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import MainLayout from '../components/layout/MainLayout';
import LoginPage from '../pages/LoginPage';
import EmailPage from '../pages/EmailPage';
import CalendarPage from '../pages/CalendarPage';
import ChatPage from '../pages/ChatPage';
import MemosPage from '../pages/MemosPage';
import ContactsPage from '../pages/ContactsPage';
import SettingsPage from '../pages/SettingsPage';
import DashboardPage from '../pages/DashboardPage';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />
  },
  {
    path: '/',
    element: <MainLayout />,
    children: [
      {
        path: '',
        element: <Navigate to="/dashboard" replace />
      },
      {
        path: 'dashboard',
        element: <DashboardPage />
      },
      {
        path: 'email',
        element: <EmailPage />
      },
      {
        path: 'calendar',
        element: <CalendarPage />
      },
      {
        path: 'chat',
        element: <ChatPage />
      },
      {
        path: 'memos',
        element: <MemosPage />
      },
      {
        path: 'contacts',
        element: <ContactsPage />
      },
      {
        path: 'settings',
        element: <SettingsPage />
      },
      {
        path: '*',
        element: <Navigate to="/dashboard" replace />
      }
    ]
  },
  {
    path: '*',
    element: <Navigate to="/dashboard" replace />
  }
]);
