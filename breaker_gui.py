#!/usr/bin/env python3
import tkinter as tk
import threading
import time
import os
import signal
import sys
from queue import Queue, Empty

class BreakerIED:
    def __init__(self, interface="enp0s3"):
        self.root = tk.Tk()
        self.root.title("Breaker IED - GOOSE Subscriber")
        self.root.geometry("500x550")
        
        # Data variables
        self.interface = interface
        self.trip_status = tk.StringVar(value="INACTIVE")
        self.close_status = tk.StringVar(value="INACTIVE")
        self.fault_type = tk.StringVar(value="Unknown")
        self.prot_element = tk.StringVar(value="--")
        self.current = tk.StringVar(value="0.0 A")
        self.voltage = tk.StringVar(value="0 V")
        self.frequency = tk.StringVar(value="0.0 Hz")
        self.breaker_status = tk.StringVar(value="OPEN")
        self.last_update = tk.StringVar(value="Never")
        
        self.subscriber_process = None
        self.data_queue = Queue()
        self.setup_gui()
        self.start_subscriber()  # Auto-start
        self.root.after(100, self.process_queue)
        
    def setup_gui(self):
        # Title
        tk.Label(self.root, text="Breaker IED Monitor", font=("Arial", 16, "bold")).pack(pady=10)
        tk.Label(self.root, text=f"Interface: {self.interface}", font=("Arial", 10)).pack()
        
        # Status Frame
        status_frame = tk.LabelFrame(self.root, text="Connection Status", padx=10, pady=10)
        status_frame.pack(fill="x", padx=10, pady=5)
        
        tk.Label(status_frame, text="Last Update:").pack(anchor="w")
        tk.Label(status_frame, textvariable=self.last_update, font=("Arial", 10, "bold")).pack(anchor="w")
        
        # Commands Frame
        cmd_frame = tk.LabelFrame(self.root, text="Received Commands", padx=10, pady=10)
        cmd_frame.pack(fill="x", padx=10, pady=5)
        
        trip_frame = tk.Frame(cmd_frame)
        trip_frame.pack(fill="x", pady=2)
        tk.Label(trip_frame, text="Trip Command:", width=15, anchor="w").pack(side="left")
        self.trip_label = tk.Label(trip_frame, textvariable=self.trip_status, 
                                  font=("Arial", 12, "bold"), width=10)
        self.trip_label.pack(side="left")
        
        close_frame = tk.Frame(cmd_frame)
        close_frame.pack(fill="x", pady=2)
        tk.Label(close_frame, text="Close Command:", width=15, anchor="w").pack(side="left")
        self.close_label = tk.Label(close_frame, textvariable=self.close_status,
                                   font=("Arial", 12, "bold"), width=10)
        self.close_label.pack(side="left")
        
        # Breaker Status Frame
        breaker_frame = tk.LabelFrame(self.root, text="Breaker Status", padx=10, pady=10)
        breaker_frame.pack(fill="x", padx=10, pady=5)
        
        self.breaker_canvas = tk.Canvas(breaker_frame, width=100, height=100, bg="white")
        self.breaker_canvas.pack()
        
        tk.Label(breaker_frame, text="Breaker Position:", font=("Arial", 12)).pack()
        self.breaker_status_label = tk.Label(breaker_frame, textvariable=self.breaker_status,
                                           font=("Arial", 14, "bold"))
        self.breaker_status_label.pack()
        
        # Fault Info Frame
        fault_frame = tk.LabelFrame(self.root, text="Fault Information", padx=10, pady=10)
        fault_frame.pack(fill="x", padx=10, pady=5)
        
        info_grid = tk.Frame(fault_frame)
        info_grid.pack(fill="x")
        
        tk.Label(info_grid, text="Fault Type:", width=15, anchor="w").grid(row=0, column=0, sticky="w")
        tk.Label(info_grid, textvariable=self.fault_type, width=20, anchor="w").grid(row=0, column=1, sticky="w")
        
        tk.Label(info_grid, text="Protection Element:", width=15, anchor="w").grid(row=1, column=0, sticky="w")
        tk.Label(info_grid, textvariable=self.prot_element, width=20, anchor="w").grid(row=1, column=1, sticky="w")
        
        # Measurements Frame
        meas_frame = tk.LabelFrame(self.root, text="Measurements", padx=10, pady=10)
        meas_frame.pack(fill="x", padx=10, pady=5)
        
        meas_grid = tk.Frame(meas_frame)
        meas_grid.pack(fill="x")
        
        tk.Label(meas_grid, text="Current:", width=15, anchor="w").grid(row=0, column=0, sticky="w")
        tk.Label(meas_grid, textvariable=self.current, width=20, anchor="w").grid(row=0, column=1, sticky="w")
        
        tk.Label(meas_grid, text="Voltage:", width=15, anchor="w").grid(row=1, column=0, sticky="w")
        tk.Label(meas_grid, textvariable=self.voltage, width=20, anchor="w").grid(row=1, column=1, sticky="w")
        
        tk.Label(meas_grid, text="Frequency:", width=15, anchor="w").grid(row=2, column=0, sticky="w")
        tk.Label(meas_grid, textvariable=self.frequency, width=20, anchor="w").grid(row=2, column=1, sticky="w")
        
        # Status
        tk.Label(self.root, text="Monitoring GOOSE Messages", 
                font=("Arial", 12, "bold"), fg="blue").pack(pady=10)
        
        self.update_display()
        self.draw_breaker()
        
    def update_display(self):
        # Update command label colors
        if self.trip_status.get() == "ACTIVE":
            self.trip_label.config(fg="red", bg="yellow")
        else:
            self.trip_label.config(fg="black", bg="lightgray")
            
        if self.close_status.get() == "ACTIVE":
            self.close_label.config(fg="green", bg="lightgreen")
        else:
            self.close_label.config(fg="black", bg="lightgray")
            
        # Update breaker status color
        if self.breaker_status.get() == "CLOSED":
            self.breaker_status_label.config(fg="green")
        else:
            self.breaker_status_label.config(fg="red")
            
        self.root.after(100, self.update_display)
        
    def draw_breaker(self):
        self.breaker_canvas.delete("all")
        if self.breaker_status.get() == "CLOSED":
            # Closed breaker - connected line
            self.breaker_canvas.create_line(20, 50, 80, 50, width=4, fill="green")
            self.breaker_canvas.create_rectangle(35, 40, 65, 60, fill="green", outline="black")
        else:
            # Open breaker - gap
            self.breaker_canvas.create_line(20, 50, 40, 50, width=4, fill="red")
            self.breaker_canvas.create_line(60, 50, 80, 50, width=4, fill="red")
            self.breaker_canvas.create_rectangle(35, 40, 45, 60, fill="red", outline="black")
            self.breaker_canvas.create_rectangle(55, 40, 65, 60, fill="red", outline="black")
        
        self.root.after(100, self.draw_breaker)
        
    def start_subscriber(self):
        threading.Thread(target=self.run_subscriber, daemon=True).start()
            
    def run_subscriber(self):
        # Monitor the shared file for GOOSE data
        while True:
            try:
                # Read data from shared file written by subscriber
                with open('/tmp/goose_data.txt', 'r') as f:
                    data = f.read().strip().split(',')
                    if len(data) >= 7:
                        self.data_queue.put(data[:7])
            except FileNotFoundError:
                pass
            except Exception:
                # Ignore transient parsing errors but continue polling
                pass
            time.sleep(0.1)

    def process_queue(self):
        try:
            while True:
                data = self.data_queue.get_nowait()
                self.trip_status.set("ACTIVE" if data[0] == "1" else "INACTIVE")
                self.close_status.set("ACTIVE" if data[1] == "1" else "INACTIVE")
                fault_types = {"0": "No Fault", "1": "Overcurrent", "2": "Differential", "3": "Distance"}
                self.fault_type.set(fault_types.get(data[2], "Unknown"))
                self.prot_element.set(data[3])
                self.current.set(f"{data[4]} A")
                self.voltage.set(f"{data[5]} V")

                try:
                    frequency = float(data[6])
                except (TypeError, ValueError):
                    frequency = 0.0
                self.frequency.set(f"{frequency:.1f} Hz")

                if data[0] == "1":
                    self.breaker_status.set("OPEN")
                elif data[1] == "1":
                    self.breaker_status.set("CLOSED")

                self.last_update.set(time.strftime("%H:%M:%S"))
        except Empty:
            pass

        self.root.after(100, self.process_queue)

    def cleanup(self, signum=None, frame=None):
        try:
            os.remove('/tmp/goose_data.txt')
        except OSError:
            pass
        self.root.quit()
        sys.exit(0)
        
    def run(self):
        signal.signal(signal.SIGINT, self.cleanup)
        signal.signal(signal.SIGTERM, self.cleanup)
        try:
            self.root.protocol("WM_DELETE_WINDOW", self.cleanup)
            self.root.mainloop()
        except KeyboardInterrupt:
            self.cleanup()

if __name__ == "__main__":
    import sys
    interface = sys.argv[1] if len(sys.argv) > 1 else "enp0s3"
    app = BreakerIED(interface)
    app.run()
