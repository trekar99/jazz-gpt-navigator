#!/usr/bin/env python3
"""
Sonabe — Jazz GPT Navigator
============================
Entry point.  Run with:  python run.py
"""

from server.app import app, socketio

if __name__ == "__main__":
    import logging
    logging.getLogger(__name__).info("🎷  Sonabe — http://localhost:5000")
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
