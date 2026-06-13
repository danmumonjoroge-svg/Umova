/* =========================================================
   AUTHSERVICE.JS
   ADVANCED SUPABASE AUTHENTICATION SERVICE
   MEMBER + STAFF AUTH
========================================================= */

import { supabase } from "../../supabaseClient";

/* =========================================================
   HELPERS
========================================================= */

const normalize =
  (value) =>
    String(value || "")
      .trim();

const normalizeLower =
  (value) =>
    normalize(value)
      .toLowerCase();

const createResponse =
  ({
    success = false,
    message = "",
    data = null,
    error = null,
  }) => {

    return {
      success,
      message,
      data,
      error,
    };
  };

/* =========================================================
   MEMBER LOGIN
========================================================= */

export const loginUser =
  async ({
    memberNo,
    password,
  }) => {

    try {

      const normalizedMemberNo =
        normalizeLower(
          memberNo
        );

      const normalizedPassword =
        normalize(password);

      if (
        !normalizedMemberNo
      ) {

        return createResponse({
          success: false,
          message:
            "Member number required",
        });
      }

      if (
        !normalizedPassword
      ) {

        return createResponse({
          success: false,
          message:
            "Password required",
        });
      }

      console.log(
        "MEMBER LOGIN START:",
        normalizedMemberNo
      );

      /* =====================================================
         MEMBER CHECK
      ===================================================== */

      const {
        data: member,
        error: memberError,
      } = await supabase
        .from("members")
        .select("*")
        .eq(
          "member_no",
          normalizedMemberNo
        )
        .maybeSingle();

      console.log(
        "MEMBER RESPONSE:",
        {
          member,
          memberError,
        }
      );

      if (
        memberError
      ) {

        return createResponse({
          success: false,
          message:
            memberError.message,
          error:
            memberError,
        });
      }

      if (!member) {

        return createResponse({
          success: false,
          message:
            "Member account not found",
        });
      }

      /* =====================================================
         PASSWORD CHECK
      ===================================================== */

      const databasePassword =
        String(
          member.password || ""
        ).trim();

      const enteredPassword =
        String(
          normalizedPassword
        ).trim();

      if (
        databasePassword !==
        enteredPassword
      ) {

        return createResponse({
          success: false,
          message:
            "Incorrect password",
        });
      }

      /* =====================================================
         FIRST LOGIN
      ===================================================== */

      const firstLogin =
        String(
          member.first_time_login ||
          ""
        )
          .toLowerCase()
          .trim();

      if (
        firstLogin ===
          "yes" ||
        firstLogin ===
          "true" ||
        firstLogin ===
          "1"
      ) {

        return createResponse({
          success: true,
          message:
            "Password setup required",
          data: {
            requiresPasswordChange:
              true,
            member,
          },
        });
      }

      /* =====================================================
         SUPABASE AUTH
      ===================================================== */

      let authSession =
        null;

      try {

        if (
          member.email
        ) {

          const {
            data: authData,
          } =
            await supabase.auth.signInWithPassword(
              {
                email:
                  member.email,
                password:
                  normalizedPassword,
              }
            );

          authSession =
            authData?.session ||
            null;
        }

      } catch (authError) {

        console.log(
          "AUTH LOGIN WARNING:",
          authError
        );
      }

      /* =====================================================
         STAFF DETECTION
      ===================================================== */

      let staffProfile =
        null;

      try {

        const {
          data: staff,
        } = await supabase
          .from("users")
          .select("*")
          .eq(
            "member_id",
            member.id
          )
          .maybeSingle();

        if (staff) {

          staffProfile =
            staff;
        }

      } catch (staffErr) {

        console.log(
          "STAFF CHECK ERROR:",
          staffErr
        );
      }

      /* =====================================================
         AUDIT LOG
      ===================================================== */

      try {

        await supabase
          .from(
            "audit_logs"
          )
          .insert([
            {
              action:
                "MEMBER_LOGIN",
              email:
                member.email ||
                null,
              member_no:
                normalizedMemberNo,
              created_at:
                new Date().toISOString(),
            },
          ]);

      } catch (auditErr) {

        console.log(
          "AUDIT WARNING:",
          auditErr
        );
      }

      /* =====================================================
         SUCCESS
      ===================================================== */

      return createResponse({
        success: true,
        message:
          "Login successful",
        data: {
          member,
          session:
            authSession,
          staffProfile,
          hasStaffAccess:
            !!staffProfile,
        },
      });

    } catch (err) {

      console.log(
        "LOGIN ERROR:",
        err
      );

      return createResponse({
        success: false,
        message:
          "Unexpected authentication error",
        error: err,
      });
    }
  };

/* =========================================================
   ADMIN LOGIN
========================================================= */

export const loginAdmin =
  async ({
    email,
    pin,
  }) => {

    try {

      const normalizedEmail =
        normalizeLower(
          email
        );

      const normalizedPin =
        normalize(pin);

      if (
        !normalizedEmail
      ) {

        return createResponse({
          success: false,
          message:
            "Email required",
        });
      }

      if (
        !normalizedPin
      ) {

        return createResponse({
          success: false,
          message:
            "PIN required",
        });
      }

      console.log(
        "ADMIN LOGIN:",
        normalizedEmail
      );

      /* =====================================================
         STAFF CHECK
      ===================================================== */

      const {
        data: user,
        error,
      } = await supabase
        .from("users")
        .select("*")
        .eq(
          "email",
          normalizedEmail
        )
        .maybeSingle();

      if (error) {

        return createResponse({
          success: false,
          message:
            error.message,
          error,
        });
      }

      if (!user) {

        return createResponse({
          success: false,
          message:
            "Staff account not found",
        });
      }

      /* =====================================================
         PIN VALIDATION
      ===================================================== */

      const dbPin =
        String(
          user.admin_pin || ""
        ).trim();

      if (
        dbPin !==
        normalizedPin
      ) {

        return createResponse({
          success: false,
          message:
            "Invalid PIN",
        });
      }

      /* =====================================================
         ROLE CHECK
      ===================================================== */

      const role =
        String(
          user.role || ""
        )
          .toLowerCase()
          .trim();

      if (
        role !== "admin" &&
        role !== "staff"
      ) {

        return createResponse({
          success: false,
          message:
            "Unauthorized access",
        });
      }

      /* =====================================================
         SUPABASE AUTH
      ===================================================== */

      let authSession =
        null;

      try {

        const {
          data: authData,
        } =
          await supabase.auth.signInWithPassword(
            {
              email:
                normalizedEmail,
              password:
                normalizedPin,
            }
          );

        authSession =
          authData?.session ||
          null;

      } catch (authErr) {

        console.log(
          "AUTH WARNING:",
          authErr
        );
      }

      /* =====================================================
         AUDIT LOG
      ===================================================== */

      try {

        await supabase
          .from(
            "audit_logs"
          )
          .insert([
            {
              action:
                "ADMIN_LOGIN",
              email:
                normalizedEmail,
              role:
                role,
              created_at:
                new Date().toISOString(),
            },
          ]);

      } catch (auditErr) {

        console.log(
          "AUDIT WARNING:",
          auditErr
        );
      }

      /* =====================================================
         SUCCESS
      ===================================================== */

      return createResponse({
        success: true,
        message:
          "Admin login successful",
        data: {
          user,
          role,
          session:
            authSession,
        },
      });

    } catch (err) {

      console.log(
        "ADMIN LOGIN ERROR:",
        err
      );

      return createResponse({
        success: false,
        message:
          "Unexpected admin authentication error",
        error: err,
      });
    }
  };

/* =========================================================
   LOGOUT
========================================================= */

export const logoutUser =
  async () => {

    try {

      console.log(
        "LOGOUT START"
      );

      await supabase.auth.signOut();

      console.log(
        "LOGOUT SUCCESS"
      );

      return createResponse({
        success: true,
        message:
          "Logout successful",
      });

    } catch (err) {

      console.log(
        "LOGOUT ERROR:",
        err
      );

      return createResponse({
        success: false,
        message:
          "Logout failed",
        error: err,
      });
    }
  };

/* =========================================================
   GET CURRENT SESSION
========================================================= */

export const getCurrentSession =
  async () => {

    try {

      const {
        data,
        error,
      } =
        await supabase.auth.getSession();

      if (error) {

        return createResponse({
          success: false,
          message:
            error.message,
          error,
        });
      }

      return createResponse({
        success: true,
        data:
          data?.session ||
          null,
      });

    } catch (err) {

      return createResponse({
        success: false,
        message:
          "Session error",
        error: err,
      });
    }
  };

/* =========================================================
   GET CURRENT USER
========================================================= */

export const getCurrentUser =
  async () => {

    try {

      const {
        data,
        error,
      } =
        await supabase.auth.getUser();

      if (error) {

        return createResponse({
          success: false,
          message:
            error.message,
          error,
        });
      }

      return createResponse({
        success: true,
        data:
          data?.user ||
          null,
      });

    } catch (err) {

      return createResponse({
        success: false,
        message:
          "User fetch error",
        error: err,
      });
    }
  };

/* =========================================================
   PASSWORD RESET
========================================================= */

export const resetPassword =
  async (
    email
  ) => {

    try {

      const normalizedEmail =
        normalizeLower(
          email
        );

      if (
        !normalizedEmail
      ) {

        return createResponse({
          success: false,
          message:
            "Email required",
        });
      }

      const {
        error,
      } =
        await supabase.auth.resetPasswordForEmail(
          normalizedEmail
        );

      if (error) {

        return createResponse({
          success: false,
          message:
            error.message,
          error,
        });
      }

      return createResponse({
        success: true,
        message:
          "Password reset email sent",
      });

    } catch (err) {

      return createResponse({
        success: false,
        message:
          "Reset error",
        error: err,
      });
    }
  };

/* =========================================================
   CHANGE PASSWORD
========================================================= */

export const changePassword =
  async (
    newPassword
  ) => {

    try {

      if (
        !newPassword
      ) {

        return createResponse({
          success: false,
          message:
            "New password required",
        });
      }

      const {
        error,
      } =
        await supabase.auth.updateUser(
          {
            password:
              newPassword,
          }
        );

      if (error) {

        return createResponse({
          success: false,
          message:
            error.message,
          error,
        });
      }

      return createResponse({
        success: true,
        message:
          "Password updated successfully",
      });

    } catch (err) {

      return createResponse({
        success: false,
        message:
          "Password update error",
        error: err,
      });
    }
  };

/* =========================================================
   SESSION LISTENER
========================================================= */

export const authListener =
  (
    callback
  ) => {

    return supabase.auth.onAuthStateChange(
      (
        event,
        session
      ) => {

        console.log(
          "AUTH STATE:",
          event
        );

        if (
          typeof callback ===
          "function"
        ) {

          callback(
            event,
            session
          );
        }
      }
    );
  };

/* =========================================================
   DEFAULT EXPORT
========================================================= */

const AuthService = {

  loginUser,

  loginAdmin,

  logoutUser,

  getCurrentSession,

  getCurrentUser,

  resetPassword,

  changePassword,

  authListener,

};

export default AuthService;