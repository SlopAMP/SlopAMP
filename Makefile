.PHONY: mac-setup mac-run mac-test mac-build mac-smoke mac-dmg

mac-setup:
	python3 -m venv .venv
	.venv/bin/pip install --require-hashes --only-binary=:all: -r macos/requirements.lock

mac-run:
	.venv/bin/python macos/run.py

mac-test:
	.venv/bin/python -m unittest discover -s tests -v

mac-smoke:
	.venv/bin/python bin/check_macos.py

mac-build:
	.venv/bin/python bin/build_macos.py

mac-dmg:
	.venv/bin/python bin/package_macos.py
