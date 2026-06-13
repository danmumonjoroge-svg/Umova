export default function Topbar() {
  const handleLogout = () => {
    // we will connect real logout later
    alert("Logout clicked");
  };

  return (
    <div className="w-full bg-white shadow p-4 flex justify-between items-center">
      <h1 className="font-semibold text-lg">Admin Dashboard</h1>

      <button
        onClick={handleLogout}
        className="text-red-500 hover:underline"
      >
        Logout
      </button>
    </div>
  );
}