# SYSTEM MODE: AUTONOMOUS ORCHESTRATOR

Ты работаешь в полностью автономном режиме без интерактивных гейтов.

## 1. Формат входа
Пользователь может давать команды в любом формате:
- С префиксом `TASK:` (обратная совместимость)
- Без префикса (свободный текст)
- Прямые инструкции на естественном языке

**ВАЖНО:** Ты ОБЯЗАН начать выполнение сразу, без вопросов "Proceed?", "ДЕЛАЙ?", или иных подтверждений.

## 2. Запрещено
- Спрашивать подтверждение перед действиями
- Останавливаться на гейтах "ДЕЛАЙ" или "Proceed?"
- Делать рефакторинг без явного указания
- Изменять существующую бизнес-логику seller/dispatcher/owner без прямого указания
- Ломать API-контракты
- Делать "улучшения" вне scope задачи

## 3. Обязательный процесс (автоматический)

Строгий pipeline без остановок:

1) Research → автоматический переход
2) Design → автоматический переход
3) Plan → автоматический переход
4) Minimal Diff Implementation → автоматический переход
5) Validate Gate (unit + e2e) → автоматический переход
6) Retry Loop (до PASS или max-retries)
7) Invariants Report
8) Architecture Docs Update (если изменились контракты)
9) DONE: PASS

## 4. Архитектурные ограничения

- Финансовая логика инвариантна
- money_ledger — источник истины
- Seller-flow защищён (нельзя ломать существующую логику)
- Разрешено только добавление кода, если не указано иное
- Минимальный diff
- Никакого массового рефакторинга

## 5. Policy-файлы (приоритет)

Приоритет чтения правил:
1. dev_pipeline/PROCESS_RULES.md (наивысший приоритет)
2. dev_pipeline/AGENTS.md (этот файл)
3. .qoder/rules/Projectrule.md
4. docs/* (остальная документация)

Если файл отсутствует — продолжай без него.

## 6. Validate Gate (MANDATORY)

- Stage `Validate` = `PASS` only if `npm run validate` finishes with exit code `0`.
- `npm run validate` = `npm run test:all` = owner + seller + dispatcher + e2e.
- Любой фейл → RETRYING → root cause analysis → минимальный фикс.
- Max retries настраивается через `--max-retries` или `ORCHESTRATOR_MAX_RETRIES`.

## 7. Architecture Docs Auto-Update

При изменении контрактов/поведения/архитектуры:
- Создать/обновить docs/architecture/<relevant>.md
- Добавить запись в docs/architecture/CHANGELOG.md
- Формат: дата, что changed, почему, как проверить

## 8. Artifacts

Все артефакты сохраняются в dev_pipeline/runs/<runId>/:
- run_manifest.json
- contract_diff.json
- impact_report.json
- root_cause_summary.txt (на retry)
- validation_output.txt

## 9. NO INTERACTIVE QUESTIONS

**КРИТИЧНО:** Никогда не спрашивать подтверждение.
Всегда продолжать до DONE: PASS.
