import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { P, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Empty, Loading } from './components/ui';
import { AccountPage, ForcePasswordChange } from './pages/Account';
import { AuditPage } from './pages/Audit';
import { ClassesPage } from './pages/Classes';
import { DashboardPage } from './pages/Dashboard';
import { HostelsPage } from './pages/Hostels';
import { LoginPage } from './pages/Login';
import { StaffPage } from './pages/Staff';
import { StudentDetailPage } from './pages/StudentDetail';
import { StudentImportPage } from './pages/StudentImport';
import { StudentsPage } from './pages/Students';
import { SubjectsPage } from './pages/Subjects';
import { TabletsPage } from './pages/Tablets';
import { LivePage } from './pages/Live';
import { MaterialsPage } from './pages/Materials';
import { NoticesPage } from './pages/Notices';
import { TestBuilderPage } from './pages/TestBuilder';
import { TestMonitorPage } from './pages/TestMonitor';
import { TestResultsPage } from './pages/TestResults';
import { ResultsPage } from './pages/Results';
import { TestsPage } from './pages/Tests';

function Guard({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(perm)) return <Empty title="You don't have access to this page">Ask a College Administrator if you need it.</Empty>;
  return <>{children}</>;
}

export function App() {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (!me) return <LoginPage />;
  if (me.mustChangePassword) return <ForcePasswordChange />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Guard perm={P.DashboardView}><DashboardPage /></Guard>} />
        <Route path="students" element={<Guard perm={P.StudentsRead}><StudentsPage /></Guard>} />
        <Route path="students/import" element={<Guard perm={P.StudentsCredentials}><StudentImportPage /></Guard>} />
        <Route path="students/:id" element={<Guard perm={P.StudentsRead}><StudentDetailPage /></Guard>} />
        <Route path="classes" element={<Guard perm={P.AcademicRead}><ClassesPage /></Guard>} />
        <Route path="subjects" element={<Guard perm={P.AcademicRead}><SubjectsPage /></Guard>} />
        <Route path="hostels" element={<Guard perm={P.AcademicRead}><HostelsPage /></Guard>} />
        <Route path="tablets" element={<Guard perm={P.TabletsRead}><TabletsPage /></Guard>} />
        <Route path="materials" element={<Guard perm={P.MaterialsRead}><MaterialsPage /></Guard>} />
        <Route path="tests" element={<Guard perm={P.TestsRead}><TestsPage /></Guard>} />
        <Route path="tests/new" element={<Guard perm={P.TestsWrite}><TestBuilderPage /></Guard>} />
        <Route path="tests/:id" element={<Guard perm={P.TestsRead}><TestBuilderPage /></Guard>} />
        <Route path="tests/:id/monitor" element={<Guard perm={P.TestsRead}><TestMonitorPage /></Guard>} />
        <Route path="tests/:id/results" element={<Guard perm={P.TestsReview}><TestResultsPage /></Guard>} />
        <Route path="results" element={<Guard perm={P.TestsReview}><ResultsPage /></Guard>} />
        <Route path="notices" element={<Guard perm={P.NoticesRead}><NoticesPage /></Guard>} />
        <Route path="live" element={<Guard perm={P.LiveRead}><LivePage /></Guard>} />
        <Route path="staff" element={<Guard perm={P.StaffRead}><StaffPage /></Guard>} />
        <Route path="audit" element={<Guard perm={P.AuditRead}><AuditPage /></Guard>} />
        <Route path="account" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
