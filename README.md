# Pioneer Sheets

Устанавливаемое приложение Pioneer: TanStack Start + Nitro, React, открытые плагины Univer, Yjs, PGlite через Drizzle. Один backend обслуживает документы, файлы, совместную работу и MCP. Собственного входа, пользовательских токенов и самостоятельного браузерного режима нет.

Для разработки внутри Pioneer зарегистрируйте проект командой `pioneer dev app add . --url http://127.0.0.1:3713`, сохраните её JSON в `credential.json` и запустите `bun run dev`. Данные хранятся в `.sheets-data` или `APP_DATA`. [Запуск в dev](docs/DEVELOPMENT.md)

Установленный пакет использует App SDK и доверенную identity Pioneer. Требования к установке и ещё не проверенные возможности host перечислены в [docs/PIONEER-REQUIRED-CHANGES.md](docs/PIONEER-REQUIRED-CHANGES.md). Успешный тестовый proxy не подтверждает готовность host.

## Организация исходников

Весь код приложения находится в `src`: `components`, `client`, `server`, `shared`. Схемы — `src/server/db/schema`, упорядоченные миграции и metadata Drizzle — `drizzle`. Прежние корневые `sdk`, `components`, `lib`, `server` удалены после переноса. Карта модулей и порядок изменения БД: [ARCHITECTURE.md](docs/ARCHITECTURE.md). Обоснование файлов рефакторинга: [REFACTORING.md](docs/REFACTORING.md).

Текущий структурный рефакторинг не проверялся запуском тестов, typecheck, dev или сборки. Ранее зафиксированные результаты относятся к прежнему коду.

## Интерфейс

Оболочка использует Tailwind CSS 4 и shadcn/ui с компонентным пресетом `b24` (Nova, Lucide, небольшой радиус). UI-шрифт оболочки — Inter из пресета b24. Цвета и mono-шрифт приходят из темы Pioneer через SDK. Компоненты в `src/components/ui` добавлены официальным CLI; прикладные экраны собираются из них. Документ не прокручивается: библиотека, панели и диалоги имеют собственные ограниченные области прокрутки. Univer и его стили остаются отдельной областью. Правила границы и обоснование файлов: [UI-MIGRATION.md](docs/UI-MIGRATION.md).

## Что находится в приложении

- Библиотека таблиц: создание, поиск, сортировка, переименование, копии, избранное, корзина и восстановление.
- Редактор Univer: формулы, форматирование, фильтры, сортировка, таблицы, проверки данных, условное форматирование, изображения и ссылки.
- Совместное редактирование и выделения пользователей/агентов, история, черновики с проверкой владельцем.
- AI SDK через HTTP MCP: изолированный Facade runtime, staging/pull/commit, справочник API, структурная инспекция, PNG, ресурсы и настройки. Файловые операции полностью доступны через MCP, включая порционную передачу bytes.
- Файлы, версии и возобновляемая загрузка; импорт XLSX/CSV/TSV/JSON и экспорт XLSX/CSV/TSV/JSON/PDF с диагностикой преобразования.
- Идентичность из Pioneer, native theme, размещение и закрытие представления с ожиданием сохранения.

## Runtime

`app.json` описывает Node runtime и UI. Приложение использует `@pioneercompany/app-sdk@0.4.0`. Все HTTP-запросы, assets, readiness, renderer и WebSocket требуют credential текущего execution. Пользователь берётся из проверенного `Pioneer-App-User-Id`; MCP дополнительно требует `Pioneer-App-Agent-Id`.

Gateway монтирует пакет Sheets в `/app`, а данные — в `APP_DATA` (`/data`). PGlite хранит базу в `/data/sheets.pgdata`, вложения — в `/data/sheets.pgdata.files`. Обновление кода не затрагивает этот каталог. Одновременно запускается один backend на установку/workspace.

Сохранено означает ACK после коммита в PGlite. В изолированном WebView нет localStorage/IndexedDB; неподтверждённые изменения живут в памяти текущего представления и повторяются после reconnect. Без соединения редактирование приостанавливается. Закрытие/переход через UI ждёт ACK; принудительное уничтожение процесса/представления может потерять ещё не подтверждённый ввод.

## Сборка установочного пакета

[Sheets PR](.github/workflows/ci.yml) запускает проверку типов, сборку и тесты для pull request в `main`. После обычного пуша или merge в `main` проверки не запускаются.

[Publish Sheets](.github/workflows/package.yml) запускается при пуше тега `vX.Y.Z`. Версии в `app.json` и `package.json` должны совпадать с версией тега. Релизный workflow собирает и проверяет универсальный установочный архив в закреплённом образе Debian Trixie с Node 26 и Bun 1.4.3. Архив содержит JavaScript и WASM для обеих архитектур Gateway. Тесты выполняются в workflow для pull request.

Для разработки нужны зависимости и `credential.json` из `pioneer dev app add`. `predev` готовит два изолированных JS worker-entry и локальный справочник Facade, а приложение обслуживает Vite с горячей перезагрузкой.

Sheets использует `@pioneercompany/app-sdk@0.4.0` с поддержкой `host.render`. В обоих режимах Gateway создаёт PDF и PNG и передаёт Sheets данные пользователя и агента.

Релиз публикует в GitHub Releases `sheets-<version>.tar.gz`, SHA-256 и JSON с размерами архива и результатом сверки с лимитами Gateway.

## Проверки без запуска Pioneer

```sh
bun run typecheck
bun run test
bun run build
bunx playwright install --only-shell chromium
bun run test:e2e
```

Для независимых Office-проверок требуется Python с openpyxl/python-docx/pypdf/Pillow: `OFFICE_PYTHON=/path/to/python bun run test`. Он используется только тестами и не входит в runtime.

E2E самостоятельно запускает backend с временным bootstrap/APP_DATA и тестовый прокси с opaque iframe, ограничениями Gateway и отдельными идентичностями Pioneer. MCP/download части прокси моделируют предложенный контракт, а не уже реализованные возможности основного проекта. Проверяются два пользователя, MCP-агент, renderer, права, файлы, Office, большие сообщения, темы и перезапуск. Тестовый прокси не является вторым режимом приложения и не поставляется в payload.

Текущие упрощения и проверки: [docs/REFACTORING.md](docs/REFACTORING.md). Предыдущая квалификация установочного пакета: [docs/VALIDATION.md](docs/VALIDATION.md).
