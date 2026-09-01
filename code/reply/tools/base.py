from abc import ABC, abstractmethod


class Tool(ABC):
    """A tool the reply engine can route to, plan against, and execute.

    `property_keys` declares the argument names this tool accepts -- the
    resolver filters unknown keys against this before dispatch. An empty
    tuple means the tool takes no arguments (both v1 tools: the dashboard
    backend they proxy has no per-request parameters).
    """

    name: str
    description: str
    property_keys: tuple = ()

    @abstractmethod
    def execute(self, args: dict) -> dict:
        """Run the tool. Must not raise -- catch failures internally and
        return {"error": "..."} so callers never need to guard execute()."""
        raise NotImplementedError
