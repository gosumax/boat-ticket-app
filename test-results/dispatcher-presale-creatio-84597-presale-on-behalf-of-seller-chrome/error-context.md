# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e4]:
    - heading "Вход в систему" [level=1] [ref=e5]
    - generic [ref=e6]: Неверное имя пользователя или пароль
    - generic [ref=e7]:
      - generic [ref=e8]: Логин
      - combobox [ref=e9]: dispatcher
    - generic [ref=e10]:
      - generic [ref=e11]: Пароль
      - textbox [ref=e12]: "123456"
    - generic [ref=e13]:
      - checkbox "Запомнить пароль" [ref=e14]
      - text: Запомнить пароль
    - button "Войти" [ref=e15] [cursor=pointer]
  - button "Скачать debug" [ref=e16] [cursor=pointer]
```