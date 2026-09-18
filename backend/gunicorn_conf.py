"""Gunicorn settings shared by the production containers.

Used with --preload: the master process imports app.py once (its heavy
imports and its import-time database work) and then forks the workers,
instead of every worker importing everything itself in parallel on a
2-vCPU box. That cuts the restart gap on deploy and shares the imported
modules' memory between workers - but anything opened before the fork
(notably SQLAlchemy connections) would be shared by all workers and
corrupt each other, so each worker drops the inherited pool first.
"""


def post_fork(server, worker):
    try:
        import app as app_module
        from core.database import db

        with app_module.app.app_context():
            # close=False: don't close the master's sockets (the master may
            # still be using them), just stop this worker from reusing them.
            db.engine.dispose(close=False)
    except Exception as e:  # never stop a worker from booting over this
        server.log.warning(f"post_fork: could not dispose inherited DB pool: {e}")
