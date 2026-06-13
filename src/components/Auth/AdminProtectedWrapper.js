import React, { useEffect, useState } from "react";
import {
  Navigate,
  useLocation,
} from "react-router-dom";

export default function AdminProtectedWrapper({
  children,
}) {

  /* ======================================================
     STATES
  ====================================================== */

  const location =
    useLocation();

  const [loading, setLoading] =
    useState(true);

  const [authorized, setAuthorized] =
    useState(false);

  const [redirectTo, setRedirectTo] =
    useState("/admin-login");

  /* ======================================================
     SECURITY VALIDATION
  ====================================================== */

  useEffect(() => {

    validateAdminSession();

  }, []);

  /* ======================================================
     VALIDATE SESSION
  ====================================================== */

  const validateAdminSession =
    async () => {

      try {

        /* ======================================================
           STORAGE VALUES
        ====================================================== */

        const adminVerified =
          localStorage.getItem(
            "admin_verified"
          );

        const role =
          localStorage.getItem(
            "role"
          );

        const loginTime =
          localStorage.getItem(
            "admin_login_time"
          );

        const sessionData =
          localStorage.getItem(
            "staff_session"
          );

        const profileData =
          localStorage.getItem(
            "staff_profile"
          );

        /* ======================================================
           NO SESSION
        ====================================================== */

        if (
          !sessionData ||
          !profileData
        ) {

          clearSession();

          setRedirectTo(
            "/admin-login"
          );

          return;
        }

        /* ======================================================
           PARSE SESSION
        ====================================================== */

        let parsedSession =
          null;

        let parsedProfile =
          null;

        try {

          parsedSession =
            JSON.parse(
              sessionData
            );

          parsedProfile =
            JSON.parse(
              profileData
            );

        } catch (err) {

          console.log(
            "SESSION PARSE ERROR:",
            err
          );

          clearSession();

          setRedirectTo(
            "/admin-login"
          );

          return;
        }

        /* ======================================================
           INVALID USER
        ====================================================== */

        if (
          !parsedSession?.id ||
          !parsedProfile?.id
        ) {

          clearSession();

          setRedirectTo(
            "/admin-login"
          );

          return;
        }

        /* ======================================================
           VERIFY ROLE
        ====================================================== */

        const normalizedRole =
          String(
            role ||
            parsedSession.role ||
            parsedProfile.role ||
            ""
          )
            .toLowerCase()
            .trim();

        const allowedRoles = [
          "admin",
          "staff",
        ];

        if (
          !allowedRoles.includes(
            normalizedRole
          )
        ) {

          clearSession();

          setRedirectTo(
            "/member"
          );

          return;
        }

        /* ======================================================
           VERIFY FLAG
        ====================================================== */

        if (
          adminVerified !==
          "true"
        ) {

          clearSession();

          setRedirectTo(
            "/admin-login"
          );

          return;
        }

        /* ======================================================
           SESSION EXPIRY
        ====================================================== */

        if (
          loginTime
        ) {

          const current =
            Date.now();

          const diff =
            current -
            Number(
              loginTime
            );

          // 8 HOURS

          const maxTime =
            1000 *
            60 *
            60 *
            8;

          if (
            diff > maxTime
          ) {

            clearSession();

            setRedirectTo(
              "/admin-login"
            );

            return;
          }
        }

        /* ======================================================
           INACTIVITY TIMER
        ====================================================== */

        const lastActivity =
          localStorage.getItem(
            "last_admin_activity"
          );

        if (
          lastActivity
        ) {

          const inactiveDiff =
            Date.now() -
            Number(
              lastActivity
            );

          // 2 HOURS INACTIVE

          const inactiveLimit =
            1000 *
            60 *
            60 *
            2;

          if (
            inactiveDiff >
            inactiveLimit
          ) {

            clearSession();

            setRedirectTo(
              "/admin-login"
            );

            return;
          }
        }

        /* ======================================================
           UPDATE ACTIVITY
        ====================================================== */

        localStorage.setItem(
          "last_admin_activity",
          Date.now()
        );

        /* ======================================================
           ACCESS GRANTED
        ====================================================== */

        setAuthorized(
          true
        );

      } catch (err) {

        console.log(
          "ADMIN WRAPPER ERROR:",
          err
        );

        clearSession();

        setRedirectTo(
          "/admin-login"
        );

      } finally {

        setLoading(
          false
        );
      }
    };

  /* ======================================================
     CLEAR SESSION
  ====================================================== */

  const clearSession =
    () => {

      localStorage.removeItem(
        "admin_verified"
      );

      localStorage.removeItem(
        "admin_login_time"
      );

      localStorage.removeItem(
        "staff_session"
      );

      localStorage.removeItem(
        "staff_profile"
      );

      localStorage.removeItem(
        "role"
      );

      localStorage.removeItem(
        "last_admin_activity"
      );
    };

  /* ======================================================
     ACTIVITY TRACKING
  ====================================================== */

  useEffect(() => {

    const updateActivity =
      () => {

        localStorage.setItem(
          "last_admin_activity",
          Date.now()
        );
      };

    window.addEventListener(
      "click",
      updateActivity
    );

    window.addEventListener(
      "keydown",
      updateActivity
    );

    window.addEventListener(
      "mousemove",
      updateActivity
    );

    return () => {

      window.removeEventListener(
        "click",
        updateActivity
      );

      window.removeEventListener(
        "keydown",
        updateActivity
      );

      window.removeEventListener(
        "mousemove",
        updateActivity
      );
    };

  }, []);

  /* ======================================================
     LOADING SCREEN
  ====================================================== */

  if (
    loading
  ) {

    return (

      <div
        style={{
          minHeight:
            "100vh",

          display:
            "flex",

          alignItems:
            "center",

          justifyContent:
            "center",

          background:
            "linear-gradient(135deg,#020617,#0f172a,#052e16)",

          color:
            "white",

          flexDirection:
            "column",

          gap:
            "20px",
        }}
      >

        <div
          style={{
            width:
              "55px",

            height:
              "55px",

            borderRadius:
              "50%",

            border:
              "5px solid rgba(255,255,255,0.2)",

            borderTop:
              "5px solid #22c55e",

            animation:
              "spin 1s linear infinite",
          }}
        />

        <h3>
          Verifying secure access...
        </h3>

      </div>
    );
  }

  /* ======================================================
     REDIRECT
  ====================================================== */

  if (
    !authorized
  ) {

    return (
      <Navigate
        to={redirectTo}
        replace
        state={{
          from:
            location.pathname,
        }}
      />
    );
  }

  /* ======================================================
     ACCESS GRANTED
  ====================================================== */

  return children;
}