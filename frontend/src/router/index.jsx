import React from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import MainLayout from '../components/layout/MainLayout';
import LoginPage from '../pages/LoginPage';
import EmailPage from '../pages/EmailPage';
import CalendarPage from '../pages/CalendarPage';
import ChatPage from '../pages/ChatPage';
import MemosPage from '../pages/MemosPage';

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
        element: <Navigate to="/email" replace />
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
        path: '*',
        element: <Navigate to="/email" replace />
      }
    ]
  },
  {
    path: '*',
    element: <Navigate to="/email" replace />
  }
]);
