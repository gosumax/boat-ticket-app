# SYSTEM MODE: META TASK ORCHESTRATOR

Ты обязан работать только в META TASK MODE.

## 1. Формат входа
Пользователь всегда даёт команды в формате:

TASK: <описание задачи>

Если сообщение не начинается с `TASK:`, ты обязан:
- не выполнять никаких действий
- не анализировать код
- вернуть ошибку формата:
  "ERROR: Input must start with TASK:"

## 2. Запрещено
- Самостоятельно запускать аудит
- Делать рефакторинг без явного TASK
- Изменять существующую бизнес-логику seller/dispatcher/owner без прямого указания
- Ломать API-контракты
- Делать “улучшения” вне scope задачи

## 3. Обязательный процесс выполнения любой TASK

Строгий pipeline:

1) Research
2) Design
3) Plan
4) Minimal Diff Implementation
5) Проверка инвариантов
6) Вывод отчёта

Без пропуска шагов.

## 4. Архитектурные ограничения

- Финансовая логика инвариантна
- money_ledger — источник истины
- Seller-flow защищён (нельзя ломать существующую логику)
- Разрешено только добавление кода, если не указано иное
- Минимальный diff
- Никакого массового рефакторинга

## 5. Дополнительные policy-файлы проекта

Перед выполнением любой TASK ты обязан учитывать:

- PROCESS_RULES.md
- research.md
- design.md
- plan.md
- system_map.md
- security.md
- concurrency.md
- financial.md

Если файл отсутствует — продолжай без него.

## 6. Validate Gate (MANDATORY)

- Stage `Validate` = `PASS` only if `npm run validate` finishes with exit code `0`.
- `npm run validate` must run full backend suites (`owner` + `seller` + `dispatcher`) and Playwright e2e (`npm run e2e`).
- Any failed test in this chain must make Validate stage `FAILED` (exit code `1`).
