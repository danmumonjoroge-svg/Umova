import React from "react";
import { BrowserRouter } from "react-router-dom";
import ChamaRouter from "./ChamaRouter";
import { ChamaProvider } from "./ChamaContext";

export default function ChamaApp() {
  return (
    <BrowserRouter>
      <ChamaProvider>
        <ChamaRouter />
      </ChamaProvider>
    </BrowserRouter>
  );
}