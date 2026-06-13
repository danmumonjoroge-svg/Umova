import React from "react";
import logo from "../assets/umovalogo.png";

const UmovaLogo = ({ size = 60, showText = true }) => {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <img
        src={logo}
        alt="Umova Logo"
        style={{
          width: size,
          height: size,
          objectFit: "contain",
        }}
      />

      {showText && (
        <span style={{ fontWeight: "bold", fontSize: "18px" }}>
          Umova Investment Ltd
        </span>
      )}
    </div>
  );
};

export default UmovaLogo;