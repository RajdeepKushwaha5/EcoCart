"""Which model the agents run on.

ECOCART_MODEL picks it:
  bedrock:<model or inference profile id>   Amazon Bedrock (the default, once model access is enabled)
  local:<model id>                          any OpenAI-compatible server on this machine, Ollama by default

ECOCART_LOCAL_URL points local: at another OpenAI-compatible server (for example a hosted one), and
ECOCART_LOCAL_KEY_FILE names a file holding its API key. Keep that file outside the repository.
"""

import os

DEFAULT_MODEL = "bedrock:in.anthropic.claude-haiku-4-5-20251001-v1:0"
# Ollama serves an OpenAI-compatible API on this port. For LM Studio use http://localhost:1234/v1.
LOCAL_URL = os.environ.get("ECOCART_LOCAL_URL", "http://localhost:11434/v1")
LOCAL_KEY_FILE = os.environ.get("ECOCART_LOCAL_KEY_FILE")
REGION = os.environ.get("AWS_REGION", "ap-south-1")
# Caps so no agent can run on forever: tokens per answer, and turns and tokens per task.
MAX_ANSWER_TOKENS = 3000
LIMITS = {"turns": 6, "output_tokens": 6000}


def local_key():
    """The key for a hosted OpenAI-compatible server, read from a file so it never sits in the code or a command line."""
    if not LOCAL_KEY_FILE:
        return "local"  # Ollama and LM Studio accept any key.
    return open(LOCAL_KEY_FILE, encoding="utf-8").read().strip()


def build_model(spec=None):
    spec = spec or os.environ.get("ECOCART_MODEL", DEFAULT_MODEL)
    provider, _, model_id = spec.partition(":")
    if provider == "bedrock":
        from strands.models import BedrockModel

        return BedrockModel(model_id=model_id, region_name=REGION, temperature=0, max_tokens=MAX_ANSWER_TOKENS)
    if provider == "local":
        from strands.models.openai import OpenAIModel

        return OpenAIModel(client_args={"base_url": LOCAL_URL, "api_key": local_key()}, model_id=model_id,
                           params={"temperature": 0, "max_tokens": MAX_ANSWER_TOKENS})
    raise SystemExit(f"Unknown model '{spec}'. Use bedrock:<id> or local:<id>.")


def ask(agent, prompt, schema=None):
    """Run one agent task within the limits. Returns the typed answer (or the text), or None if the agent gave none."""
    try:
        result = agent(prompt, structured_output_model=schema, limits=LIMITS)
    except Exception as error:  # A capped or malformed run counts as no answer, never as a made-up one.
        print(f"[{agent.name}] gave no usable answer: {type(error).__name__}", flush=True)
        return None
    return result.structured_output if schema else str(result)
