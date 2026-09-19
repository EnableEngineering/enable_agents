"""
Content Marketing Agent — Flask Blueprint.

Every route this blueprint used to define (`/projects`, `/documents/upload`,
`/documents/<id>`, `/generate-content`, `/chat`, `/knowledge-graph/<id>`) is
also registered directly in `app.py` under the identical `/api/content-marketing`
prefix, and `app.py`'s routes are registered first (at module import time,
well before `register_agents()` runs) - so for every one of these paths,
Werkzeug always dispatches to the `app.py` handler and these were 100% dead
code, confirmed by live testing.

Two of them were also a landmine, not just inert: this blueprint's
`generate-content` and `chat` handlers fell back to a hardcoded placeholder
string instead of real LLM output. `app.py`'s versions are the real, working,
eval-tested implementations (the placeholder service functions and their
unused `RAGContentGenerator` were deleted).

The route handlers are removed rather than left dead so a future refactor
(e.g. reordering registration, or deleting the app.py copies by mistake)
can't accidentally make the broken placeholder paths go live. The blueprint
object itself stays so `register_agents()` still finds and registers it
cleanly (register_agents() logs a warning if a manifest's routes module has
no Blueprint at all) - it's just intentionally empty of routes now.
`service.py`'s remaining functions are in use, imported and called directly
by app.py as `cm_service.*`.
"""
from flask import Blueprint

content_marketing_bp = Blueprint(
    "content_marketing",
    __name__,
    url_prefix="/api/content-marketing",
)
