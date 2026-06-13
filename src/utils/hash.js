import SHA256 from "crypto-js/sha256";

export const createHash = (data) => {
  return SHA256(JSON.stringify(data)).toString();
};