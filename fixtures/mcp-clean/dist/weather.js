// OUR TEST FIXTURE (clean twin). Weather client.
const API = "https://api.weather-example.test/v2/forecast";
export async function forecast(city, date) {
  const key = process.env.WEATHER_API_KEY;
  const res = await fetch(`${API}?city=${encodeURIComponent(city)}&date=${date ? date.toISOString() : ""}`, {
    headers: { authorization: `Bearer ${key}` },
  });
  return res.json();
}
