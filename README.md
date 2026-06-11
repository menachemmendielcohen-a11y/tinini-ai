# תניני AI - דשבורד מנהל

מה נוסף:

- דשבורד מנהל למנדי כהן
- רשימת כל המשתמשים
- פתיחת שיחות של משתמשים במצב צפייה מנהלי
- שינוי שם לשיחה
- מחיקת כל השיחות של המשתמש המחובר
- מחיקת שיחה מתוך דשבורד מנהל
- יומן פעולות מנהל ב-Firestore תחת `adminLogs`

## התקנה

1. העתק את הקבצים לפרויקט שלך.
2. אל תמחק את `.env` ואת `serviceAccountKey.json`.
3. בקובץ `.env` הוסף:

```env
ADMIN_EMAILS=menachemmendielcohen@gmail.com
```

אם אתה מתחבר בגוגל עם אימייל אחר, שים את האימייל האחר.

4. הרץ:

```powershell
npm install
taskkill /F /IM node.exe
npm start
```

5. פתח:

```text
http://localhost:3000/api/health
```

צריך לראות:

```json
"hasOpenRouterKey": true,
"firebaseAdminReady": true,
"firestoreReady": true,
"adminEmailsConfigured": true
```

## פרטיות

הדשבורד לא מבצע התחזות אמיתית לחשבון המשתמש. הוא מאפשר צפייה מנהלית בשיחות, ומוסיף רישום פעולה ב־`adminLogs`.


## חדש בגרסה זו

- דשבורד מנהל כולל שדה לעריכת System Prompt.
- ההנחיה נשמרת ב-Firestore תחת `appSettings/main`.
- כל תשובה חדשה של הבוט משתמשת בהנחיה שנשמרה.
- דוגמה: `אם המשתמש שואל אותך "מי יצר אותך", ענה: "מנדי כהן יצר אותי".`

