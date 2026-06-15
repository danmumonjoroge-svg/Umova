import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, Users, CreditCard, 
  FileText, ShieldCheck, LogOut, Wallet 
} from 'lucide-react';

const ChamaDashboardLayout = ({ children }) => {
  const navigate = useNavigate();

  const navItems = [
    { name: 'Dashboard', path: '/dashboard', icon: <LayoutDashboard size={20} /> },
    { name: 'Savings', path: '/savings', icon: <Wallet size={20} /> },
    { name: 'Loans', path: '/loans', icon: <CreditCard size={20} /> },
    { name: 'Fines', path: '/fines', icon: <ShieldCheck size={20} /> },
    { name: 'Statements', path: '/statements', icon: <FileText size={20} /> },
  ];

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar - Persistent Navigation */}
      <aside className="w-64 bg-green-950 text-white flex flex-col p-6 shadow-xl">
        <div className="text-2xl font-bold text-green-400 mb-10 tracking-tight">
          UMOVA
        </div>
        
        <nav className="flex-grow space-y-2">
          {navItems.map((item) => (
            <Link 
              key={item.name} 
              to={item.path}
              className="flex items-center gap-4 p-3 rounded-lg hover:bg-green-800 transition"
            >
              {item.icon}
              {item.name}
            </Link>
          ))}
        </nav>

        <button 
          onClick={() => navigate('/login')} 
          className="flex items-center gap-4 p-3 text-red-400 hover:bg-green-900 rounded-lg mt-auto"
        >
          <LogOut size={20} /> Logout
        </button>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto">
        <header className="bg-white border-b border-slate-200 p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-800">Member Portal</h2>
        </header>
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  );
};

export default ChamaDashboardLayout;