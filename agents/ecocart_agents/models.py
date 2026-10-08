"""Which model the agents run on.

ECOCART_MODEL picks it:
  bedrock:<model or inference profile id>   Amazon Bedrock (the default, once model access is enabled)
  local:<model id>                          any OpenAI-compatible server, such as LM Studio on this machine
"""

import os

DEFAULT_MODEL = "bedrock:in.anthropic.claude-haiku-4-5-20251001-v1:0"
LOCAL_URL = os.environ.get("ECOCART_LOCAL_URL", "http://localhost:1234/v1")
REGION = os.environ.get("AWS_REGION", "ap-south-1")
# Caps so no agent can run on forever: tokens per answer, and turns and tokens per task.
MAX_ANSWER_TOKENS = 3000
LIMITS = {"turns": 6, "output_tokens": 6000}


def build_model(spec=None):
    spec = spec or os.environ.get("ECOCART_MODEL", DEFAULT_MODEL)
    provider, _, model_id = spec.partition(":")
    if provider == "bedrock":
        from strands.models import BedrockModel

        return BedrockModel(model_id=model_id, region_name=REGION, temperature=0, max_tokens=MAX_ANSWER_TOKENS)
    if provider == "local":
        from strands.models.openai import OpenAIModel

        return OpenAIModel(client_args={"base_url": LOCAL_URL, "api_key": "local"}, model_id=model_id,
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
