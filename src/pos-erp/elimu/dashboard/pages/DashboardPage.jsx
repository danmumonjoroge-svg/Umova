// elimu/dashboard/pages/DashboardPage.jsx -- the management dashboard page (also the home screen for anyone who may see it).
import React from 'react';
import DashboardView from '../components/DashboardView.jsx';

export default function DashboardPage({ basePath = '/school' }) {
  return <DashboardView basePath={basePath} heading="Management dashboard" />;
}
