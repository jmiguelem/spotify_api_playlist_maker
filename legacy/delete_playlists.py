import pyautogui
import time

# Give some time to switch to the target window
time.sleep(2)  # Adjust the delay as needed

# Step 1: Click on the window at specified coordinate
x, y = 361, 389  # Replace with the coordinates of the target window

for i in range(5):
    time.sleep(2) 
    pyautogui.click(x, y)

    time.sleep(1) 
    # Step 2: Press the "Delete" key
    pyautogui.press('backspace')

    time.sleep(.5) 
    # Step 3: Press the "Enter" key
    pyautogui.press('enter')
