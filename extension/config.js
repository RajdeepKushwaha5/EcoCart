// Live API deployed with `sam deploy` (stack ecocart-india, ap-south-1).
// For local development, run `python scripts/local_server.py` and use "http://localhost:3000".
// If this address changes, update host_permissions in manifest.json to match.
export const API_BASE_URL = "https://8el9hdnif0.execute-api.ap-south-1.amazonaws.com";

export const CITIES = [
  { id: "bengaluru", name: "Bengaluru" },
  { id: "chennai", name: "Chennai" },
  { id: "delhi-ncr", name: "Delhi NCR" },
  { id: "hyderabad", name: "Hyderabad" },
  { id: "kolkata", name: "Kolkata" },
  { id: "mumbai", name: "Mumbai" },
  { id: "pune", name: "Pune" },
];
