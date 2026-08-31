using App.Services;
using System;

namespace App;

public class Program
{
    public static void Main()
    {
        Console.WriteLine(OrderService.Describe());
    }
}
