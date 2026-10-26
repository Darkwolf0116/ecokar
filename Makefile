# EcoKar Sim - tareas de desarrollo.
# Las recetas solo usan uv y echo simple para funcionar igual con cmd.exe o sh.

.DEFAULT_GOAL := help
.PHONY: help install assets run serve dev web web-serve test lint format check clean

help:
	@echo EcoKar Sim - objetivos disponibles:
	@echo make install - instala las dependencias con uv sync
	@echo make assets  - extrae los recursos de la app desde info/Ekocar_Final.aia
	@echo make run     - inicia el simulador y abre el navegador
	@echo make serve   - inicia el simulador sin abrir el navegador
	@echo make dev     - inicia el servidor con recarga automatica en el puerto 8000
	@echo make web     - genera el sitio estatico con Pyodide en dist/ para Vercel
	@echo make web-serve - sirve dist/ en el puerto 8080 para probar el sitio estatico
	@echo make test   - ejecuta las pruebas con pytest
	@echo make lint    - revisa el codigo con ruff
	@echo make format  - da formato al codigo con ruff
	@echo make check   - ejecuta lint, comprobacion de formato y pruebas
	@echo make clean   - borra caches de pytest, ruff y __pycache__

install:
	uv sync

assets:
	uv run python scripts/extract_assets.py

run:
	uv run ecokar-sim --open

serve:
	uv run ecokar-sim

dev:
	uv run uvicorn ecokar_sim.server.app:app --reload --reload-dir src --port 8000

web:
	uv run python scripts/build_web.py

web-serve:
	uv run python -m http.server 8080 --directory dist

test:
	uv run pytest -q

lint:
	uv run ruff check .

format:
	uv run ruff format .

check:
	uv run ruff check .
	uv run ruff format --check .
	uv run pytest -q

clean:
	@uv run python -c "import pathlib, shutil; [shutil.rmtree(p, ignore_errors=True) for p in ['.pytest_cache', '.ruff_cache', *pathlib.Path('src').rglob('__pycache__'), *pathlib.Path('tests').rglob('__pycache__'), *pathlib.Path('scripts').rglob('__pycache__')]]"
	@echo Caches eliminadas
