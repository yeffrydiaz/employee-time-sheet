# Employee Time Sheet Manager

A web-based application designed to help employees easily track, manage, and submit their weekly work hours. 

## Features

* **Weekly Time Tracking**: Input "Time In", "Lunch Start", "Lunch End", and "Time Out" for each day of the week.
* **Automatic Date Population**: Simply select the "Week of" date, and the application will automatically populate the correct dates for Sunday through Saturday.
* **Automated Calculations**: Automatically calculates the total hours worked per day (accounting for lunch breaks) and the total hours for the week.
* **Digital Signatures**: Includes an interactive signature pad for employees to electronically sign their timesheets before submission.
* **Local History & Auto-Save**: Automatically saves your progress locally so you don't lose data if you close the tab. Includes a searchable history modal to retrieve and review past timesheets.
* **Print-Friendly Layout**: Optimized for printing, allowing you to easily generate physical copies of your timesheets.
* **One-Click Email Submission**: Generates a pre-formatted email with all your timesheet data, including your electronic signature, ready to be sent to management.

## Tech Stack

* **Frontend Framework**: React 18+ with TypeScript
* **Styling**: Tailwind CSS for responsive and print-optimized design
* **Icons**: Lucide React
* **Digital Signatures**: React Signature Canvas
* **Build Tool**: Vite

## Getting Started

To run this project locally:

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
4. Open your browser and navigate to the provided local URL (typically `http://localhost:3000`).

## Usage

1. Enter your **Name** and select the **Week of** date. The daily dates will auto-populate.
2. For each day worked, enter your **Time In**, **Lunch Start**, **Lunch End**, and **Time Out**.
3. Add any relevant **Notes** for specific days.
4. Sign your name in the **Employee Signature** box at the bottom.
5. Enter your manager's email in the recipient field.
6. Click **Send** to generate an email with your timesheet data, or click **Print** to print a physical copy.
7. Use the **History** button in the header to view or reload previously saved timesheets.
