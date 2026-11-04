from pydantic import ConfigDict
from pydantic.alias_generators import to_camel

# The browser sends camelCase (durationSec); tests and tools use snake_case. Accept both.
WIRE_CONFIG = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)
