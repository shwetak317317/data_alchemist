"""
Standalone Gemini connectivity test — mirrors exactly what llm.py does.

Run inside Docker:
    docker compose exec backend python test_gemini.py

Run locally (from backend/):
    GEMINI_API_KEY=your-key python test_gemini.py
"""
import os
import sys
import httpx

API_KEY = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
MODEL   = "gemini-flash-latest"   # confirmed working model name

API_KEY = os.environ.get("OLLAMA_API_KEY") 
MODEL   = os.environ.get("OLLAMA_MODEL") 
base_url= os.environ.get("OLLAMA_BASE_URL")



print(f"Key   : {API_KEY[:8]}...{API_KEY[-4:]}")
print(f"Model : {MODEL}")
from litellm import completion
import os

# os.environ['GEMINI_API_KEY'] = API_KEY
# response = completion(
#     model="gemini/gemini-2.5-flash-lite",  # or "gemini-flash-latest"
#     messages=[{"role": "user", "content": "write code for saying hi from LiteLLM"}]
# )
# print(response)

messages = [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "What is the capital of France?"},
    {"role": "assistant", "content": "The capital of France is Paris."},
    {"role": "user", "content": "what is 2+3-7*4?"},
]
 
response = completion(
    model=MODEL,
    messages=messages,
    api_base=base_url,
    api_key=API_KEY,
)

print(response.choices[0].message.content)

# url     = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
# headers = {"Content-Type": "application/json", "X-goog-api-key": API_KEY}
# payload = {
#     "contents": [{"role": "user", "parts": [{"text": "Reply with exactly: OK"}]}],
#     "generationConfig": {"maxOutputTokens": 10, "temperature": 0},
# }

# print("Calling Google AI Studio ...")
# try:
#     with httpx.Client(timeout=30) as client:
#         resp = client.post(url, headers=headers, json=payload)

#     print(f"HTTP {resp.status_code}")
#     if resp.status_code != 200:
#         print("Error:", resp.text)
#         sys.exit(1)

#     text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
#     print(f"Response: {text!r}")
#     print("OK — backend is ready to use Gemini.")

# except Exception as e:
#     print(f"Exception: {e}")
#     sys.exit(1)
