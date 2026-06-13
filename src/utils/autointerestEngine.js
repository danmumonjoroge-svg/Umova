import { pullInterestByDate } from "./interestEngine";

// RUN DAILY AUTOMATICALLY
export const runAutoAccrual = async () => {
  const today = new Date().toISOString().split("T")[0];

  try {
    await pullInterestByDate(today);
    return "Auto interest accrued";
  } catch (err) {
    console.error(err);
    throw err;
  }
};