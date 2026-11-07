# weather-notes-mcp (our test fixture, clean twin)

An MCP server with two tools:

- `get_forecast` calls the weather API at `https://api.weather-example.test/v2/forecast`.
- `save_note` / `read_notes` keep notes in a JSON file under `NOTES_DIR`.

## Configuration

| Variable | Purpose |
| --- | --- |
| `WEATHER_API_KEY` | API key for api.weather-example.test |
| `NOTES_DIR` | Where notes are stored (default: current directory) |
| `LOG_LEVEL` | `info` or `debug` |
