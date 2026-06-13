import { useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { Sun, Moon } from "lucide-react";

export default function Layout() {
  const [dark, setDark] = useState(false);

  const toggleTheme = () => {
    setDark(!dark);
    document.documentElement.classList.toggle("dark");
  };

  return (
    <div className={`flex min-h-screen ${dark ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-900"}`}>
      
      {/* Sidebar */}
      <aside className="w-64 bg-blue-700 text-white p-6 flex flex-col">
        <h1 className="text-2xl font-bold mb-6">SACCO</h1>
        <nav className="flex flex-col gap-3">
          <Link to="/dashboard" className="hover:bg-blue-600 p-2 rounded">Dashboard</Link>
          <Link to="/members" className="hover:bg-blue-600 p-2 rounded">Members</Link>
          <Link to="/loans" className="hover:bg-blue-600 p-2 rounded">Loans</Link>
          <Link to="/statements" className="hover:bg-blue-600 p-2 rounded">Statements</Link>
        </nav>

        <button
          onClick={toggleTheme}
          className="mt-auto bg-white text-blue-700 px-3 py-2 rounded flex items-center gap-2 justify-center"
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />} {dark ? "Light" : "Dark"}
        </button>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}