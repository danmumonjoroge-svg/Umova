import React from "react";
import { useNavigate } from "react-router-dom";
import "./Public.css";

const Navbar = () => {
  const navigate = useNavigate();

  return (
    <div className="navbar">

      <div className="logo" onClick={() => navigate("/")}>
        💚 Umova SACCO
      </div>

      <div className="nav-links">
        <span>About</span>
        <span>Services</span>
        <span>Loans</span>
        <span onClick={() => navigate("/login")}>Login</span>
      </div>

    </div>
  );
};

export default Navbar;